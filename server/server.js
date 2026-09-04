const express=require("express");
const cors=require("cors");
const helmet=require("helmet");
const rateLimit=require("express-rate-limit");
const bcrypt=require("bcryptjs");
const jwt=require("jsonwebtoken");
const {Pool}=require("pg");
const XLSX=require("xlsx");
const path=require("path");

const app=express();
app.use(helmet());
app.use(cors({origin:process.env.CORS_ORIGIN||true}));
app.use(express.json({limit:"2mb"}));
app.use(rateLimit({windowMs:15*60*1000,max:500}));

const PORT=process.env.PORT||8080;
const JWT_SECRET=process.env.JWT_SECRET;
if(!JWT_SECRET) throw new Error("JWT_SECRET is required");
if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSL==="false"?false:{rejectUnauthorized:false}});
const web=path.join(__dirname,"public");
app.use(express.static(web));

async function init(){
 await pool.query(`CREATE TABLE IF NOT EXISTS operators(
   id BIGSERIAL PRIMARY KEY, username TEXT UNIQUE NOT NULL,
   password_hash TEXT NOT NULL, initials TEXT NOT NULL,
   role TEXT NOT NULL DEFAULT 'OPERATOR', active BOOLEAN NOT NULL DEFAULT TRUE,
   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await pool.query(`CREATE TABLE IF NOT EXISTS records(
   id TEXT PRIMARY KEY, trailer_number TEXT NOT NULL,
   freezer_f DOUBLE PRECISION NOT NULL, cooler_f DOUBLE PRECISION NOT NULL,
   operator_initials TEXT NOT NULL, timestamp_utc BIGINT NOT NULL,
   notes TEXT DEFAULT '', synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`);
 await pool.query("CREATE INDEX IF NOT EXISTS records_timestamp_idx ON records(timestamp_utc DESC)");
 const r=await pool.query("SELECT id FROM operators LIMIT 1");
 if(!r.rowCount){
   const user=process.env.ADMIN_USERNAME||"admin";
   const pass=process.env.ADMIN_PASSWORD;
   if(!pass) throw new Error("ADMIN_PASSWORD is required on first startup");
   const hash=await bcrypt.hash(pass,12);
   await pool.query("INSERT INTO operators(username,password_hash,initials,role) VALUES($1,$2,$3,'ADMIN')",[user,hash,process.env.ADMIN_INITIALS||"AD"]);
 }
}
function auth(req,res,next){try{req.user=jwt.verify((req.headers.authorization||"").replace(/^Bearer\s+/i,""),JWT_SECRET);next()}catch(e){res.status(401).json({error:"Unauthorized"})}}
function admin(req,res,next){if(req.user.role!=="ADMIN")return res.status(403).json({error:"Admin only"});next()}
function validate(x){return x&&typeof x.id==="string"&&typeof x.trailerNumber==="string"&&Number.isFinite(+x.freezerF)&&Number.isFinite(+x.coolerF)&&typeof x.operatorInitials==="string"&&Number.isFinite(+x.timestampUtc)}
app.get("/api/health",async(req,res)=>{try{await pool.query("SELECT 1");res.json({ok:true,version:"3.0.0"})}catch(e){res.status(503).json({ok:false})}});
app.post("/api/auth/login",async(req,res)=>{try{const u=await pool.query("SELECT * FROM operators WHERE username=$1 AND active=true",[req.body.username]);if(!u.rowCount||!(await bcrypt.compare(req.body.password,u.rows[0].password_hash)))return res.status(401).json({error:"Invalid login"});const x=u.rows[0],token=jwt.sign({id:x.id,username:x.username,role:x.role,initials:x.initials},JWT_SECRET,{expiresIn:"12h"});res.json({token,username:x.username,initials:x.initials,role:x.role})}catch(e){res.status(500).json({error:"Login error"})}});
app.post("/api/sync",auth,async(req,res)=>{try{const client=await pool.connect();try{await client.query("BEGIN");for(const x of(req.body||[])){if(!validate(x))throw new Error("Invalid record");await client.query(`INSERT INTO records(id,trailer_number,freezer_f,cooler_f,operator_initials,timestamp_utc,notes) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING`,[x.id,x.trailerNumber,+x.freezerF,+x.coolerF,x.operatorInitials,+x.timestampUtc,x.notes||""])}await client.query("COMMIT");res.json({synced:(req.body||[]).length})}catch(e){await client.query("ROLLBACK");throw e}finally{client.release()}}catch(e){res.status(400).json({error:e.message})}});
app.get("/api/records",auth,async(req,res)=>{const r=await pool.query("SELECT * FROM records ORDER BY timestamp_utc DESC LIMIT 10000");res.json(r.rows)});
app.get("/api/operators",auth,admin,async(req,res)=>{const r=await pool.query("SELECT id,username,initials,role,active,created_at FROM operators ORDER BY username");res.json(r.rows)});
app.post("/api/operators",auth,admin,async(req,res)=>{const{username,password,initials,role}=req.body;if(!username||!password||!initials)return res.status(400).json({error:"username, password and initials required"});const hash=await bcrypt.hash(password,12);try{const r=await pool.query("INSERT INTO operators(username,password_hash,initials,role) VALUES($1,$2,$3,$4) RETURNING id,username,initials,role,active",[username,hash,initials,role==="ADMIN"?"ADMIN":"OPERATOR"]);res.status(201).json(r.rows[0])}catch(e){res.status(409).json({error:"Username already exists"})}});
app.patch("/api/operators/:id",auth,admin,async(req,res)=>{const r=await pool.query("UPDATE operators SET active=$1 WHERE id=$2 RETURNING id,username,initials,role,active",[!!req.body.active,req.params.id]);res.json(r.rows[0]||{})});
app.get("/api/export.xlsx",auth,admin,async(req,res)=>{const r=await pool.query("SELECT to_char(to_timestamp(timestamp_utc/1000) AT TIME ZONE 'UTC','YYYY-MM-DD') date_utc,to_char(to_timestamp(timestamp_utc/1000) AT TIME ZONE 'UTC','HH24:MI:SS') time_utc,trailer_number,freezer_f,cooler_f,CASE WHEN freezer_f BETWEEN -10 AND 10 AND cooler_f BETWEEN 34 AND 40 THEN 'OK' ELSE 'OUT OF RANGE' END status,operator_initials,notes FROM records ORDER BY timestamp_utc DESC");const rows=r.rows.map(x=>({"Date (UTC)":x.date_utc,"Time (UTC)":x.time_utc,"Trailer":x.trailer_number,"Freezer °F":x.freezer_f,"Cooler °F":x.cooler_f,"Status":x.status,"Operator Initials":x.operator_initials,"Notes":x.notes}));const wb=XLSX.utils.book_new();const ws=XLSX.utils.json_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,"Temperature Inspections");const buf=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");res.setHeader("Content-Disposition",'attachment; filename="trailer-temperature-inspections.xlsx"');res.send(buf)});
app.get("*",(req,res)=>res.sendFile(path.join(web,"index.html")));
init().then(()=>app.listen(PORT,()=>console.log("Trailer Temp V3 listening on "+PORT))).catch(e=>{console.error(e);process.exit(1)});
