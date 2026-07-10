import * as ABI from "@robbed/shared/abi";
import { createPublicClient, http } from "viem";
const rpc = "http://localhost:4545";
const pc = createPublicClient({ transport: http(rpc) });
const router = "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318";
const creator = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
// merge all error fragments so viem can name the custom error
const errAbi = [];
for (const abi of Object.values(ABI)) if (Array.isArray(abi)) for (const it of abi) if (it.type==="error") errAbi.push(it);
const abi = [...ABI.routerAbi, ...errAbi];
const deadline = BigInt(Math.floor(Date.now()/1000)+600);
const metadataHash = "0x56bfbcc14eb71fdef061f9d339326e23efe6c58767f279c2c7af79200f2c7f54";
const uri = "https://meta.robbed.example/metadata/0x56bfbcc14eb71fdef061f9d339326e23efe6c58767f279c2c7af79200f2c7f54.json";
for (const fee of [847000000000000n, 0n, 1000000000000000n]) {
  try {
    const { result } = await pc.simulateContract({
      account: creator, address: router, abi,
      functionName: "createToken",
      args: ["Feed Coin","FEED",metadataHash,uri,0n,deadline],
      value: fee,
    });
    console.log("OK fee=",fee.toString(), "->", result);
    break;
  } catch (e) {
    console.log("fee=",fee.toString(),"revert:", e.shortMessage || e.message?.split("\n")[0], "| cause:", e.cause?.data ?? e.cause?.shortMessage ?? "");
  }
}
// also read block timestamp
const blk = await pc.getBlock();
console.log("block.timestamp=", blk.timestamp.toString(), "now=", Math.floor(Date.now()/1000), "deadline=", deadline.toString());
