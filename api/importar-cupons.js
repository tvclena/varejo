import { createClient } from "@supabase/supabase-js"

export default async function handler(req, res){

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
  console.log("🚀 IMPORTAÇÃO COMPLETA")
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

  try{

    const { empresa, dataInicio, dataFim } = req.body

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE
    )

    // ================= LOGIN =================
    const loginResp = await fetch("https://varejo-six.vercel.app/api/login",{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ empresa })
    })

    const loginData = await loginResp.json()
    const token = loginData.accessToken || loginData.token

    if(!token){
      return res.status(400).json({ error:"Sem token" })
    }

    console.log("✅ TOKEN OK")

    // ================= RECEBIMENTOS =================
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

    console.log("📦 TOTAL API:", cupons.length)

    if(!cupons.length){
      return res.json({ ok:true, total:0 })
    }

    // ================= VERIFICAR EXISTENTES =================
    const ids = cupons.map(c => empresa + "_" + (c.id || c.vendaId))

    const { data: existentes } = await supabase
      .from("cupons_importados")
      .select("unique_id")
      .in("unique_id", ids)

    const setExistentes = new Set((existentes || []).map(e=>e.unique_id))

    let novos = []
    let pagamentos = []

    for(const c of cupons){

      const venda_id = c.id || c.vendaId
      if(!venda_id) continue

      const unique_id = empresa + "_" + venda_id

      if(setExistentes.has(unique_id)) continue

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

      // 💳 PAGAMENTOS
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

    console.log("🆕 NOVOS:", novos.length)

    // ================= INSERT CUPONS =================
    if(novos.length){
      const { error } = await supabase
        .from("cupons_importados")
        .insert(novos)

      if(error){
        console.log("❌ ERRO CUPONS:", error.message)
      }
    }

    // ================= INSERT PAGAMENTOS =================
    if(pagamentos.length){
      await supabase
        .from("cupons_pagamentos")
        .insert(pagamentos)
    }

    return res.json({
      ok:true,
      total: cupons.length,
      novos: novos.length,
      pagamentos: pagamentos.length
    })

  }catch(e){

    console.log("💥 ERRO:", e.message)

    return res.status(500).json({
      error:e.message
    })
  }
}
