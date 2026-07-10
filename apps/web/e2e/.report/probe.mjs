import { routerAbi } from "@robbed/shared/abi";
import { createPublicClient, http, parseAbiItem } from "viem";
const rpc = "http://localhost:4545";
const pc = createPublicClient({ transport: http(rpc) });
console.log("--- router functions ---");
for (const it of routerAbi) if (it.type==="function") console.log(it.stateMutability, it.name, "("+it.inputs.map(i=>i.type).join(",")+")");
