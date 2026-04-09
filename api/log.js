export default function handler(req, res){

  console.log("📥 LOG FRONT RECEBIDO")
  console.log(req.body)

  res.status(200).json({ ok:true })
}
