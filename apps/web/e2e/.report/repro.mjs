import { routerAbi } from "@robbed/shared/abi";
import { http, createPublicClient, createWalletClient, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const rpc="http://localhost:4545";
const chain=defineChain({id:4663,name:"fork",nativeCurrency:{name:"E",symbol:"ETH",decimals:18},rpcUrls:{default:{http:[rpc]}}});
const pc=createPublicClient({chain,transport:http(rpc)});
const creator=privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const wallet=createWalletClient({account:creator,chain,transport:http(rpc)});
const router="0x8A791620dd6260079BF849Dc5567aDC3F2FdC318";
const deadline=BigInt(Math.floor(Date.now()/1000)+600);
const mh="0x56bfbcc14eb71fdef061f9d339326e23efe6c58767f279c2c7af79200f2c7f54";
const uri="https://meta.robbed.example/x.json";
try {
  const hash=await wallet.writeContract({address:router,abi:routerAbi,functionName:"createToken",args:["Repro Coin","RPRO",mh,uri,0n,deadline],value:847000000000000n});
  const r=await pc.waitForTransactionReceipt({hash});
  console.log("createToken OK", r.status, hash);
} catch(e){
  console.log("createToken FAIL:", e.shortMessage||e.message?.split("\n")[0]);
  console.log("cause:", e.cause?.shortMessage||e.cause?.message?.split("\n")[0]);
  console.log("data:", e.cause?.data||e.details);
}
