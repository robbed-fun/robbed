import { toFunctionSelector } from "viem";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
function walk(d){let o=[];for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory())o=o.concat(walk(p));else if(p.endsWith(".sol"))o.push(p);}return o;}
const targets=["0x3cef0425","0xc9c00910"];
const files=walk("contracts");
const re=/error\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/g;
const found={};
for(const f of files){const t=readFileSync(f,"utf8");let m;while((m=re.exec(t))){const name=m[1];const types=m[2].split(",").map(s=>s.trim().split(/\s+/)[0]).filter(Boolean);const sig=`${name}(${types.join(",")})`;try{const sel=toFunctionSelector(sig);if(targets.includes(sel.toLowerCase()))console.log("MATCH",sel,sig,"in",f.split("/").pop());}catch{}}}
