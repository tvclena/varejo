import { createClient } from "@supabase/supabase-js"

export default async function handler(req, res){

  console.log("🚀 SYNC COMPLETO START")

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

    const hoje = new Date().toISOString().slice(0,10)

const empresaIndex = Number(req.query.idx || 0)

const empresas = [
  { id:"VAREJO_URL_DELICIA", nome:"DELÍCIA" },
  { id:"VAREJO_URL_VILLA", nome:"VILLA" },
  { id:"VAREJO_URL_PADARIA", nome:"PADARIA" },
  { id:"VAREJO_URL_MERCATTO", nome:"MERCATTO" }
]

const emp = empresas[empresaIndex % empresas.length]

console.log("🎯 EMPRESA DA VEZ:", emp.nome)

    
      console.log("━━━━━━━━━━━━━━━━━━━━━━━")
      console.log("🏢 EMPRESA:", emp.nome)
      console.log("📅 DATA:", hoje)

      try{

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

        // ================= PAGINAÇÃO COMPLETA =================
        let pagina = 0
        const limite = 500
        let totalEmpresa = 0

        while(true){

          console.log("📄 PAGINA:", pagina)

          const resp = await fetch("https://varejo-six.vercel.app/api/recebimentos",{
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({
              token,
              empresa: emp.id,
              dataInicio: hoje,
              dataFim: hoje,
              pagina,
              limite
            })
          })

          const json = await resp.json()
          const cupons = json.items || []

          console.log(`📦 RECEBIDOS: ${cupons.length}`)

          if(cupons.length === 0){
            console.log("🏁 FIM")
            break
          }

          totalEmpresa += cupons.length

          // ================= EXISTENTES =================
          const uniqueIds = cupons.map(c => emp.id + "_" + (c.id || c.vendaId))

          const { data: existentes } = await supabase
            .from("cupons_importados")
            .select("unique_id")
            .in("unique_id", uniqueIds)

          const existentesSet = new Set((existentes || []).map(e => e.unique_id))

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
            }else{
              console.log("✅ INSERIDOS:", novos.length)
              totalNovos += novos.length
            }
          }

          if(pagamentos.length){
            await supabase.from("cupons_pagamentos").insert(pagamentos)
            totalPagamentos += pagamentos.length
          }

          // próxima página
          if(cupons.length < limite){
            console.log("🏁 ÚLTIMA PAGINA")
            break
          }

          pagina++
        }

        console.log(`📊 TOTAL EMPRESA ${emp.nome}:`, totalEmpresa)

      }catch(e){
        console.log("💥 ERRO:", emp.nome, e.message)
        totalErros++
      }
    }

    console.log("━━━━━━━━━━━━━━━━━━━━━━━")
    console.log("🔥 RESUMO FINAL")
    console.log("🆕 NOVOS:", totalNovos)
    console.log("♻️ EXISTENTES:", totalExistentes)
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
