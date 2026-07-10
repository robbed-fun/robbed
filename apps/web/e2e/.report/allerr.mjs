import * as ABI from "@robbed/shared/abi";
import { toFunctionSelector, toFunctionSignature } from "viem";
const target="0x3cef0425";
const seen=new Set();
for (const [name,abi] of Object.entries(ABI)) {
  if(!Array.isArray(abi)) continue;
  for (const it of abi) if(it.type==="error"){
    const sig=toFunctionSignature(it); const sel=toFunctionSelector(sig);
    if(!seen.has(sel)){seen.add(sel); console.log(sel, sig, name); }
  }
}
console.log("target present:", seen.has(target));
// brute anti-sniper / cap / graduate candidates
const c=["EarlyBuyCapExceeded()","AntiSnipeActive()","BuyCapExceeded()","MaxBuyExceeded()","OverCap()","CapExceeded()","AlreadyGraduated()","NotGraduated()","Graduated()","ReadyToGraduate()","CurveLocked()","Locked()","GraduationLocked()","InvalidState()","WrongPhase()","NotCurvePhase()","MinOut()","SlippageExceeded()","InsufficientOutput()","TooMuchSlippage()","DeadlinePassed()","PriceOutOfRange()"];
import {toFunctionSelector as sel2} from "viem";
for(const x of c) if(sel2(x).toLowerCase()===target) console.log("BRUTE:",x);
