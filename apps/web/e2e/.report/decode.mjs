import { routerAbi, curveFactoryAbi, bondingCurveAbi } from "@robbed/shared/abi";
import { toFunctionSelector, toFunctionSignature } from "viem";
const target = "0x3cef0425";
const abis = {router:routerAbi, factory:curveFactoryAbi, curve:bondingCurveAbi};
for (const [label, abi] of Object.entries(abis)) {
  for (const item of abi) {
    if (item.type === "error") {
      const sig = toFunctionSignature(item);
      const sel = toFunctionSelector(sig);
      if (sel.toLowerCase() === target) console.log("MATCH:", label, sig, sel);
    }
    if (item.type === "function" && item.name === "createToken") {
      console.log("createToken:", toFunctionSignature(item), toFunctionSelector(toFunctionSignature(item)));
    }
  }
}
console.log("--- router errors ---");
for (const item of routerAbi) if (item.type==="error") console.log(toFunctionSelector(toFunctionSignature(item)), toFunctionSignature(item));
