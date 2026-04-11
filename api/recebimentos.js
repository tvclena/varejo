import { createClient } from "@supabase/supabase-js"

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE
)

export default async function handler(req, res){

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("🚀 SYNC RECEBIMENTOS START")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

  const startTime = Date.now()

  if(req.method !== "POST"){
    return res.status(405).json({ error:"Use POST" })
  }
  try{

    const { token, dataInicio, dataFim, empresa } = req.body

    if(!token) return res.status(400).json({ error:"Token ausente" })
    if(!empresa) return res.status(400).json({ error:"Empresa ausente" })
    if(!dataInicio || !dataFim) return res.status(400).json({ error:"Datas obrigatórias" })

    const urls = {
      VAREJO_URL_MERCATTO: "https://mercatto.varejofacil.com/api/v1/venda/cupons-fiscais",
      VAREJO_URL_VILLA: "https://deliciagourmet.varejofacil.com/api/v1/venda/cupons-fiscais",
      VAREJO_URL_PADARIA: "https://mercattodelicia.varejofacil.com/api/v1/venda/cupons-fiscais",
      VAREJO_URL_DELICIA: "https://villachopp.varejofacil.com/api/v1/venda/cupons-fiscais"
    }

    const baseURL = urls[empresa]

    if(!baseURL){
      return res.status(400).json({ error:"Empresa inválida" })
    }

    console.log(`🏢 Empresa: ${empresa}`)
    console.log(`📅 Período: ${dataInicio} → ${dataFim}`)

    const count = 100
    let pagina = 1
    let totalGeral = 0
    let totalPagamentos = 0
    const ids = new Set()

    console.log("\n📡 INICIANDO PAGINAÇÃO...\n")

    while(true){

      const url = `${baseURL}?pagina=${pagina}&count=${count}&q=dataHoraFechamentoCupom=ge=${dataInicio}T00:00:00;dataHoraFechamentoCupom=le=${dataFim}T23:59:59`

      const t0 = Date.now()

      const response = await fetch(url,{
        headers:{
          Authorization: token,
          Accept:"application/json"
        }
      })

      const tempoReq = ((Date.now() - t0)/1000).toFixed(2)

      if(!response.ok){
        const erro = await response.text()
        console.log(`❌ ERRO API (página ${pagina}):`, erro)
        throw new Error(erro)
      }

      const json = await response.json()
      const items = json.items || []

      console.log(
        `📄 Página ${pagina} | ` +
        `Itens: ${items.length} | ` +
        `Tempo: ${tempoReq}s`
      )

      if(items.length === 0){
        console.log("🏁 FIM REAL (sem itens)")
        break
      }

      const inserts = []
      const pagamentos = []

      for(const cupom of items){

        if(ids.has(cupom.id)) continue
        ids.add(cupom.id)

        const unique_id = empresa + "_" + cupom.id

        const valor_total = Number(cupom.valorTotal || 0)
        const cancelado = !!cupom.cancelada

        const finalizadora_principal =
          cupom.finalizacoes?.[0]?.descricao || null
        inserts.push({
          unique_id,
          empresa,
          empresa_id: empresa,
          venda_id: cupom.id,
          data: cupom.data,
          valor_total,
          valor_liquido: valor_total,
          finalizadora_principal,
          cancelado,
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
      if(inserts.length > 0){

        const { error } = await supabase
          .from("cupons_importados")
          .upsert(inserts, { onConflict:"unique_id" })

        if(error){
          console.log("❌ ERRO INSERT:", error.message)
        } else {
          totalGeral += inserts.length
        }
      }

      if(pagamentos.length > 0){

        await supabase
          .from("cupons_pagamentos")
          .insert(pagamentos)

        totalPagamentos += pagamentos.length
      }

      console.log(
        `💾 Inseridos: ${inserts.length} | ` +
        `💳 Pagamentos: ${pagamentos.length} | ` +
        `📊 Total: ${totalGeral}`
      )

      if(items.length < count){
        console.log("🏁 ÚLTIMA PÁGINA")
        break
      }

      pagina++
      await new Promise(r => setTimeout(r, 120))

      if(pagina > 1000){
        console.log("⛔ SEGURANÇA LOOP")
        break
      }
    }

    const tempoTotal = ((Date.now() - startTime)/1000).toFixed(2)

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    console.log("✅ FINALIZADO")
    console.log(`📊 Total inseridos: ${totalGeral}`)
    console.log(`💳 Total pagamentos: ${totalPagamentos}`)
    console.log(`📄 Total páginas: ${pagina}`)
    console.log(`⏱ Tempo total: ${tempoTotal}s`)
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    return res.json({
      ok:true,
      empresa,
      totalInseridos: totalGeral,
      totalPagamentos,
      paginas: pagina,
      tempo: tempoTotal
    })

  }catch(e){

    console.log("💥 ERRO:", e.message)

    return res.status(500).json({
      ok:false,
      error:e.message
    })
  }
}
