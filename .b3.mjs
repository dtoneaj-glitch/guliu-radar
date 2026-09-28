import fs from "node:fs";
const t=fs.readFileSync("C:/Users/amydo/.openclaw-autoclaw/workspace/.openclaw/tmp/guliu-backfill/run-daily-archive.bat","utf8").replace(/\r\n/g,"\n");
fs.writeFileSync("D:/個人台/股流Radar/guliu-radar-local/scripts/run-daily-archive.bat", t.split("\n").join("\r\n"), "ascii");
console.log("bat written (CRLF)");