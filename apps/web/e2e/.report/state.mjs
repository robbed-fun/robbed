import { curveFactoryAbi } from "@robbed/shared/abi";
import { createPublicClient, http } from "viem";
const pc = createPublicClient({ transport: http("http://localhost:4545") });
const factory="0xa513E6E4b8f2a923D98304ec87F64353C4D5C853";
const treasury="0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
for (const fn of ["pauseBuys","pauseCreates","paused"]) {
  try { const v = await pc.readContract({address:factory,abi:curveFactoryAbi,functionName:fn}); console.log(fn,"=",v);} catch(e){console.log(fn,"n/a");}
}
const code = await pc.getCode({address:treasury});
console.log("treasury code:", code ?? "0x (EOA)");
