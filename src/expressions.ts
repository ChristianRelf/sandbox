import type { ExecutionRecord, Workflow } from "./types";

export const EXPRESSION_LANGUAGE_VERSION = 1;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
export type ExpressionValueType = "missing" | "null" | "boolean" | "number" | "string" | "array" | "object";
export interface ExpressionPreview { value: unknown; type: ExpressionValueType; sources: string[]; fallbackUsed: boolean }
export interface ExpressionContext { input?: unknown; items?: unknown[]; trigger?: unknown; nodes?: Record<string,{output:unknown}>; workflow?: Record<string,unknown>; execution?: Record<string,unknown>; env?: Record<string,unknown> }

export function previewExpression(template:string, context:ExpressionContext):ExpressionPreview {
  if(template.length>16*1024)throw new Error("Expression exceeds the 16 KiB limit.");
  const sources=new Set<string>(); let fallbackUsed=false;
  const evaluate=(source:string):unknown=>{
    const alternatives=splitTopLevel(source,"??");
    for(let index=0;index<alternatives.length;index++){
      const value=evaluateAtom(alternatives[index].trim(),context,sources);
      if((value===MISSING||value===null)&&index+1<alternatives.length){fallbackUsed=true;continue;}
      if(value===MISSING)throw new Error(`Value '${source.trim()}' is missing. Use safe access or ?? to provide a fallback.`);
      return value;
    }
    return null;
  };
  const trimmed=template.trim();
  let value:unknown;
  if(trimmed.startsWith("{{")&&trimmed.endsWith("}}")&&trimmed.match(/\{\{/g)?.length===1)value=evaluate(trimmed.slice(2,-2));
  else{
    let cursor=0, rendered="";
    while(true){const start=template.indexOf("{{",cursor);if(start<0)break;const end=template.indexOf("}}",start+2);if(end<0)throw new Error("Expression is missing a closing '}}'.");rendered+=template.slice(cursor,start)+display(evaluate(template.slice(start+2,end)));cursor=end+2;}
    if(template.slice(cursor).includes("}}"))throw new Error("Expression has an unexpected closing '}}'.");
    value=rendered+template.slice(cursor);
  }
  return{value,type:valueType(value),sources:[...sources],fallbackUsed};
}

const MISSING=Symbol("missing");
function evaluateAtom(source:string,context:ExpressionContext,sources:Set<string>):unknown{
  if(source==="null")return null;if(source==="true")return true;if(source==="false")return false;
  if(/^[-+]?\d+(\.\d+)?$/.test(source))return Number(source);
  if((source.startsWith("'")&&source.endsWith("'"))||(source.startsWith('"')&&source.endsWith('"')))return source.slice(1,-1).replace(/\\n/g,"\n");
  const call=source.match(/^([A-Za-z][\w.]*)\((.*)\)$/s);if(call){const args=splitTopLevel(call[2],",").filter(Boolean).map(value=>evaluateAtom(value.trim(),context,sources));return helper(call[1],args);}
  return path(source,context,sources);
}
function path(source:string,context:ExpressionContext,sources:Set<string>):unknown{
  const root=source.match(/^[A-Za-z_][\w-]*/)?.[0];if(!root||!(root in context))throw new Error(`Unknown expression root '${root??source}'.`);
  let value=(context as Record<string,unknown>)[root];let cursor=root.length;let sourcePath=root;
  while(cursor<source.length){let safe=false,segment="";if(source.startsWith("?.",cursor)){safe=true;cursor+=2;const match=source.slice(cursor).match(/^[\w-]+/);if(!match)throw new Error("Expected a property name.");segment=match[0];cursor+=segment.length;}else if(source[cursor]==="."){cursor++;const match=source.slice(cursor).match(/^[\w-]+/);if(!match)throw new Error("Expected a property name.");segment=match[0];cursor+=segment.length;}else if(source.startsWith("?[",cursor)||source[cursor]==="["){safe=source.startsWith("?[",cursor);cursor+=safe?2:1;const end=source.indexOf("]",cursor);if(end<0)throw new Error("Array access is missing ']'.");segment=source.slice(cursor,end).trim().replace(/^['"]|['"]$/g,"");cursor=end+1;}else throw new Error(`Unexpected token near '${source.slice(cursor,24)}'.`);
    if(FORBIDDEN.has(segment))throw new Error("Prototype and constructor traversal is forbidden.");sourcePath+=`.`+segment;
    if(value==null){if(safe){value=null;continue;}return MISSING;}
    if(Array.isArray(value)&&/^\d+$/.test(segment))value=value[Number(segment)];else if(typeof value==="object"&&Object.prototype.hasOwnProperty.call(value,segment))value=(value as Record<string,unknown>)[segment];else{if(safe){value=null;continue;}return MISSING;}
  }
  sources.add(sourcePath);return value;
}
function helper(name:string,args:unknown[]):unknown{const value=args[0];switch(name){case"string":case"string.toString":return display(value);case"string.trim":return display(value).trim();case"string.lower":return display(value).toLowerCase();case"string.upper":return display(value).toUpperCase();case"number":{const number=Number(value);if(!Number.isFinite(number))throw new Error("number() could not convert its argument.");return number;}case"boolean":if(value===true||value==="true")return true;if(value===false||value==="false")return false;if(typeof value==="number")return value!==0;throw new Error("boolean() could not convert its argument.");case"json.parse":return JSON.parse(String(value));case"json.stringify":return JSON.stringify(value);case"array.first":return Array.isArray(value)?value[0]??null:null;case"array.last":return Array.isArray(value)?value.at(-1)??null:null;case"array.length":if(Array.isArray(value))return value.length;break;case"object.keys":if(value&&typeof value==="object"&&!Array.isArray(value))return Object.keys(value);break;case"object.values":if(value&&typeof value==="object"&&!Array.isArray(value))return Object.values(value);break;}throw new Error(`Helper '${name}' is not available in expression language v${EXPRESSION_LANGUAGE_VERSION}.`);}
function splitTopLevel(source:string,separator:string){const values:string[]=[];let start=0,depth=0,quote="";for(let index=0;index<source.length;index++){const char=source[index];if(quote){if(char===quote&&source[index-1]!=="\\")quote="";continue;}if(char==="'"||char==='"'){quote=char;continue;}if("([{".includes(char))depth++;else if(")] }".replace(" ","").includes(char))depth--;if(depth===0&&source.startsWith(separator,index)){values.push(source.slice(start,index));start=index+separator.length;index+=separator.length-1;}}if(depth!==0||quote)throw new Error("Expression has an unterminated string or delimiter.");values.push(source.slice(start));return values;}
function display(value:unknown){return value==null?"":typeof value==="string"?value:JSON.stringify(value);}
function valueType(value:unknown):ExpressionValueType{return value===MISSING?"missing":value===null?"null":Array.isArray(value)?"array":typeof value as ExpressionValueType;}

export function expressionContext(workflow:Workflow,run?:ExecutionRecord,currentNodeId?:string):ExpressionContext{
  const nodes=Object.fromEntries((run?.nodeExecutions??[]).map(entry=>[entry.nodeId,{output:entry.output}]));
  const upstream=workflow.edges.filter(edge=>edge.targetNodeId===currentNodeId).map(edge=>nodes[edge.sourceNodeId]?.output).filter(value=>value!==undefined);
  return{input:upstream[0]??null,items:upstream,trigger:run?.trigger??{},nodes,workflow:{id:workflow.id,name:workflow.name,description:workflow.description,schemaVersion:workflow.schemaVersion},execution:{id:run?.id??"preview",startedAt:run?.startedAt??null},env:{}};
}
