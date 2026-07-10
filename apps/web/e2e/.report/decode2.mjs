import * as ABI from "@robbed/shared/abi";
import { toFunctionSelector, toFunctionSignature } from "viem";
const target = "0x3cef0425";
for (const [name, abi] of Object.entries(ABI)) {
  if (!Array.isArray(abi)) continue;
  for (const item of abi) {
    if (item.type === "error") {
      try {
        const sig = toFunctionSignature(item);
        const sel = toFunctionSelector(sig);
        if (sel.toLowerCase() === target) console.log("MATCH:", name, sig);
      } catch {}
    }
  }
}
// brute force common candidates
const cands = ["MetadataHashMismatch()","InvalidMetadata()","InvalidFee()","FeeTooLow()","IncorrectFee()","WrongCreationFee()","InvalidCreationFee()","CreationFeeMismatch()","BadFee()","InsufficientFee()","AntiSnipeCapExceeded()","EarlyBuyCapExceeded()","SlippageExceeded()","MinReceivedNotMet()","Expired()","InvalidDeadline()","NameTooLong()","SymbolTooLong()","EmptyName()","InvalidSymbol()","MetadataMismatch()","HashMismatch()"];
for (const c of cands) {
  if (toFunctionSelector(c).toLowerCase()===target) console.log("BRUTE MATCH:", c);
}
console.log("exports:", Object.keys(ABI).join(", "));
