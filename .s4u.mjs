import fs from "node:fs";
const p="D:/個人台/股流Radar/guliu-radar-local/scripts/register-daily-task.ps1";
let c=fs.readFileSync(p,"utf8");
if(!c.includes("<LogonType>S4U</LogonType>")){
  c=c.replace("<LogonType>InteractiveToken</LogonType>","<LogonType>S4U</LogonType>");
  c=c.replace("#  可靠性設定：","#  執行身分：S4U（服務使用者）— 登出／未登入也能執行，不需儲存密碼\n#  可靠性設定：");
  fs.writeFileSync(p,c,"utf8");
  console.log("ps1 → S4U");
} else console.log("已是 S4U");