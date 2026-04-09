import { createClient } from "@supabase/supabase-js"

export default async function handler(req, res){

  const startGlobal = Date.now()

  console.log("🚀 SYNC GLOBAL CUPONS START")

  try{

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    )
    const empresas = [
      { id:"VAREJO_URL_DELICIA", nome:"DELÍCIA" },
      { id:"VAREJO_URL_VILLA", nome:"VILLA" },
      { id:"VAREJO_URL_PADARIA", nome:"PADARIA" },
      { id:"VAREJO_URL_MERCATTO", nome:"MERCATTO" }
    ]

    let totalNovos = 0
    let totalExistentes = 0
    let totalPagamentos = 0
    let totalErros = 0

    for(const emp of empresas){

      const startEmpresa = Date.now()

      console.log("━━━━━━━━━━━━━━━━━━━━━━━")
      console.log("🏢 EMPRESA:", emp.nome)

      try{

        // ================= PEGAR ÚLTIMA DATA =================
        const { data: ultima } = await supabase
          .from("cupons_importados")
          .select("data")
          .eq("empresa_id", emp.id)
          .order("data", { ascending:false })
          .limit(1)

        const ultimaData = ultima?.[0]?.data

        const dataInicio = ultimaData
          ? new Date(new Date(ultimaData).getTime() - 86400000).toISOString().slice(0,10)
          : new Date(Date.now() - 86400000 * 3).toISOString().slice(0,10)

        const dataFim = new Date().toISOString().slice(0,10)

        console.log("📅 PERIODO:", dataInicio, "→", dataFim)

        // ================= LOGIN =================
        const loginResp = await fetch("https://varejo-six.vercel.app/api/login",{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ empresa: emp.id })
        })

        const loginData = await loginResp.json()
        const token = loginData.accessToken || loginData.token

        if(!token){
          console.log("❌ SEM TOKEN")
          totalErros++
          continue
        }

        console.log("✅ TOKEN OK")

        // ================= RECEBIMENTOS =================
let pagina = 0
const limite = 500
let todosCupons = []

while(true){

  console.log("📄 BUSCANDO PAGINA:", pagina)

  const resp = await fetch("https://varejo-six.vercel.app/api/recebimentos",{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({
      token,
      empresa: emp.id,
      dataInicio,
      dataFim,
      pagina,   // 🔥 IMPORTANTE
      limite    // 🔥 IMPORTANTE
    })
  })

  const json = await resp.json()
  const items = json.items || []

  console.log(`📦 PAGINA ${pagina}:`, items.length)

  if(items.length === 0){
    console.log("🏁 FIM DA PAGINAÇÃO")
    break
  }

  todosCupons = todosCupons.concat(items)

  if(items.length < limite){
    console.log("🏁 ÚLTIMA PAGINA")
    break
  }

  pagina++
}

        const json = await resp.json()
const cupons = todosCupons
        console.log("📊 TOTAL RECEBIDO:", cupons.length)

        if(!cupons.length){
          console.log("⚠️ NADA NOVO")
          continue
        }

        // ================= EXISTENTES =================
        const uniqueIds = cupons.map(c => emp.id + "_" + (c.id || c.vendaId))

        const { data: existentes } = await supabase
          .from("cupons_importados")
          .select("unique_id")
          .in("unique_id", uniqueIds)

        const existentesSet = new Set((existentes || []).map(e => e.unique_id))

        console.log("♻️ JÁ EXISTIAM:", existentesSet.size)

        const novos = []
        const pagamentos = []

        for(const cupom of cupons){

          const venda_id = cupom.id || cupom.vendaId
          if(!venda_id) continue

          const unique_id = emp.id + "_" + venda_id

          if(existentesSet.has(unique_id)){
            totalExistentes++
            continue
          }

          const valor_total = Number(cupom.valorTotal || 0)

          novos.push({
            unique_id,
            empresa: emp.nome,
            empresa_id: emp.id,
            venda_id,
            data: cupom.data,
            valor_total,
            valor_liquido: valor_total,
            finalizadora_principal: cupom.finalizacoes?.[0]?.descricao || null,
            cancelado: !!cupom.cancelada,
            raw: cupom
          })

          if(Array.isArray(cupom.finalizacoes)){
            cupom.finalizacoes.forEach(f=>{
              pagamentos.push({
                cupom_unique_id: unique_id,
                finalizadora_id: String(f.finalizadoraId),
                finalizadora_nome: f.descricao,
                valor: Number(f.valor || 0)
              })
            })
          }

        }

        console.log("🆕 NOVOS:", novos.length)

        if(novos.length){

          const { error } = await supabase
            .from("cupons_importados")
            .insert(novos)

          if(error){
            console.log("❌ ERRO INSERT:", error.message)
            totalErros++
            continue
          }

          console.log("✅ INSERIDOS:", novos.length)
          totalNovos += novos.length
        }

        if(pagamentos.length){
          await supabase.from("cupons_pagamentos").insert(pagamentos)
          totalPagamentos += pagamentos.length
        }

        console.log("⏱️ TEMPO:", ((Date.now()-startEmpresa)/1000).toFixed(2)+"s")

      }catch(e){
        console.log("💥 ERRO:", emp.nome, e.message)
        totalErros++
      }

    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━")
    console.log("🔥 RESUMO FINAL")
    console.log("🆕 NOVOS:", totalNovos)
    console.log("♻️ IGNORADOS:", totalExistentes)
    console.log("💳 PAGAMENTOS:", totalPagamentos)
    console.log("❌ ERROS:", totalErros)

    return res.json({
      ok:true,
      novos: totalNovos,
      existentes: totalExistentes
    })

  }catch(e){
    return res.status(500).json({ error:e.message })
  }
}
