import {describe,expect,it} from "vitest";
import {previewExpression} from "./expressions";
describe("expression preview",()=>{
 const context={input:{amount:0,missing:null,rows:[{name:"Ada"}]},nodes:{extract:{output:{data:{heading:"Hello"}}}},trigger:{body:{email:"a@example.com"}},workflow:{name:"Example"},execution:{id:"run-1"},env:{ALLOWED_VALUE:"yes"}};
 it("preserves full-field types and interpolates",()=>{expect(previewExpression("{{ input.amount }}",context).value).toBe(0);expect(previewExpression("Title: {{ nodes.extract.output.data.heading }}",context).value).toBe("Title: Hello");});
 it("supports arrays, helpers and fallbacks",()=>{expect(previewExpression("{{ string.upper(input.rows[0].name) }}",context).value).toBe("ADA");expect(previewExpression("{{ input.unknown ?? 'fallback' }}",context).fallbackUsed).toBe(true);});
 it("blocks traversal and unknown host roots",()=>{expect(()=>previewExpression("{{ input.constructor }}",context)).toThrow(/forbidden/);expect(()=>previewExpression("{{ process.env.SECRET }}",context)).toThrow(/Unknown/);});
});
