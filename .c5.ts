import Database from "better-sqlite3";
const db=new Database("server/data/radar.db",{readonly:true});
console.log(db.prepare("select date from archive_meta order by date").all().map(r=>r.date).join(", "));