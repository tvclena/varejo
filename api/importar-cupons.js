import { createClient } from "@supabase/supabase-js"

function logBox(titulo){
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log(`🚀 ${titulo}`)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
}

function logStep(msg){
  console.log(`➡️ ${msg}`)
}

function logOk(msg){
  console.log(`✅ ${msg}`)
}

function logWarn(msg){
  console.log(`⚠️ ${msg}`)
}

function logError(msg){
  console.log(`❌ ${msg}`)
}

function logInfo(msg){
  console.log(`📊 ${msg}`)
}

function tempo(start){
  return ((Date.now() - start)/1000).toFixed(2) + "s"
}

export default async function handler(req, res){

  const startGlobal = Date.now()

  logBox("IMPORTAÇÃO COMPLETA")

  try{

    const { empresa, dataInicio, dataFim } = req.body

    logInfo(`Empresa: ${empresa}`)
    logInfo(`Período: ${dataInicio} → ${dataFim}`)

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    )

    // ================= LOGIN =================
    const tLogin = Date.now()

    logBox("LOGIN")

    const loginResp = await fetch("https://varejo-six.vercel.app/api/login",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ empresa })
    })

    const loginData = await loginResp.json()
    const token = loginData.accessToken || loginData.token

    if(!token){
      logError("Token não recebido")
      return res.status(400).json({ error:"Sem token" })
    }

    logOk(`Token obtido (${tempo(tLogin)})`)

    // ================= RECEBIMENTOS =================
    const tApi = Date.now()

    logBox("BUSCA API VAREJO")

    const resp = await fetch("https://varejo-six.vercel.app/api/recebimentos",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({
        token,
        empresa,
        dataInicio,
        dataFim
      })
    })

    const json = await resp.json()
    const cupons = json.items || []

    logInfo(`Total recebido da API: ${cupons.length}`)
    logOk(`Tempo API: ${tempo(tApi)}`)

    if(!cupons.length){
      logWarn("Nenhum cupom retornado")
      return res.json({ ok:true, total:0 })
    }

    // ================= VERIFICAR EXISTENTES =================
    const tCheck = Date.now()

    logBox("VERIFICAÇÃO DE DUPLICADOS")

    const ids = cupons.map(c => empresa + "_" + (c.id || c.vendaId))

    const { data: existentes } = await supabase
      .from("cupons_importados")
      .select("unique_id")
      .in("unique_id", ids)

    const setExistentes = new Set((existentes || []).map(e=>e.unique_id))

    logInfo(`Já existentes: ${setExistentes.size}`)
    logOk(`Tempo verificação: ${tempo(tCheck)}`)

    let novos = []
    let pagamentos = []
    let ignorados = 0

    // ================= PROCESSAMENTO =================
    const tProcess = Date.now()

    logBox("PROCESSAMENTO")

    for(const c of cupons){

      const venda_id = c.id || c.vendaId
      if(!venda_id){
        ignorados++
        continue
      }

      const unique_id = empresa + "_" + venda_id

      if(setExistentes.has(unique_id)){
        ignorados++
        continue
      }

      const valor_total = Number(c.valorTotal || 0)

      novos.push({
        unique_id,
        empresa_id: empresa,
        venda_id,
        data: c.dataVenda,
        valor_total,
        cancelado: !!c.cancelada,
        raw: c
      })

      if(Array.isArray(c.finalizacoes)){
        c.finalizacoes.forEach(f=>{
          pagamentos.push({
            cupom_unique_id: unique_id,
            finalizadora_id: String(f.finalizadoraId),
            finalizadora_nome: f.descricao,
            valor: Number(f.valor || 0)
          })
        })
      }
    }

    logInfo(`Novos: ${novos.length}`)
    logInfo(`Ignorados: ${ignorados}`)
    logInfo(`Pagamentos gerados: ${pagamentos.length}`)
    logOk(`Tempo processamento: ${tempo(tProcess)}`)

    // ================= INSERT CUPONS =================
    const tInsert = Date.now()

    logBox("INSERT CUPONS")

    if(novos.length){
      const { error } = await supabase
        .from("cupons_importados")
        .insert(novos)

      if(error){
        logError(`Erro ao inserir cupons: ${error.message}`)
      }else{
        logOk(`Inseridos: ${novos.length}`)
      }
    }else{
      logWarn("Nenhum novo cupom para inserir")
    }

    logOk(`Tempo insert cupons: ${tempo(tInsert)}`)

    // ================= INSERT PAGAMENTOS =================
    const tPag = Date.now()

    logBox("INSERT PAGAMENTOS")

    if(pagamentos.length){
      const { error } = await supabase
        .from("cupons_pagamentos")
        .insert(pagamentos)

      if(error){
        logError(`Erro pagamentos: ${error.message}`)
      }else{
        logOk(`Pagamentos inseridos: ${pagamentos.length}`)
      }
    }else{
      logWarn("Nenhum pagamento para inserir")
    }

    logOk(`Tempo pagamentos: ${tempo(tPag)}`)

    // ================= FINAL =================
    logBox("FINALIZADO")

    logInfo(`Empresa: ${empresa}`)
    logInfo(`Total API: ${cupons.length}`)
    logInfo(`Novos inseridos: ${novos.length}`)
    logInfo(`Pagamentos: ${pagamentos.length}`)
    logInfo(`Tempo total: ${tempo(startGlobal)}`)

    return res.json({
      ok:true,
      empresa,
      total: cupons.length,
      novos: novos.length,
      pagamentos: pagamentos.length,
      tempo: tempo(startGlobal)
    })

  }catch(e){

    logBox("ERRO GERAL")
    logError(e.message)

    return res.status(500).json({
      error:e.message
    })
  }
}
