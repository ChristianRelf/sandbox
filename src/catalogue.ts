import { Bell, Blocks, Braces, Camera, Clock3, Code2, Copy, Database, Download, FileClock, FileInput, FileJson, FileOutput, FilePlus2, FileText, FolderOpen, GitBranch, GitCompare, Globe2, Hand, Keyboard, ListTree, LogIn, Mail, MailPlus, MessageSquare, MousePointerClick, Navigation, ScanSearch, Send, ShieldQuestion, TableProperties, Tag, Trash2, Upload, X, type LucideIcon } from "lucide-react";
import type { BuiltInNodeType, InstalledPlugin, NodePortDefinition, NodeType, PluginManifestNode, WorkflowNode } from "./types";

export type NodeGroup = "Triggers" | "Logic" | "Data" | "Browser" | "Network" | "Communication" | "System" | "Plugins";
export type NodePlacement="local"|"paired_runner"|"hosted_runner"|"managed_browser";
export interface NodeDefinition { type:NodeType; name:string; description:string; group:NodeGroup; icon:LucideIcon; defaults:Record<string,unknown>; summary:(config:Record<string,unknown>)=>string; inputs:NodePortDefinition[]; outputs:NodePortDefinition[]; sideEffect:boolean; placements:NodePlacement[]; configurationSchema?:Record<string,unknown>; connectionRequirements?:PluginManifestNode["connectionRequirements"]; fileInputs?:PluginManifestNode["fileInputs"]; externalEffect?:PluginManifestNode["externalEffect"] }
type NodeDefinitionInput=Omit<NodeDefinition,"inputs"|"outputs"|"sideEffect"|"placements">&Partial<Pick<NodeDefinition,"inputs"|"outputs"|"sideEffect"|"placements">>;
export interface PluginNodeChoice { plugin:InstalledPlugin; node:PluginManifestNode }
const BASE_NODE_DEFINITIONS:NodeDefinitionInput[] = [
  {type:"manual_trigger",name:"Manual Trigger",description:"Run from the toolbar",group:"Triggers",icon:Hand,defaults:{},summary:()=>"Starts on demand"},
  {type:"schedule_trigger",name:"Schedule Trigger",description:"Run on a local schedule",group:"Triggers",icon:Clock3,defaults:{scheduleType:"minutes",every:15,time:"09:00",cron:"0 */15 * * *"},summary:c=>c.scheduleType==="minutes"?`Every ${c.every ?? 15} minutes`:c.scheduleType==="daily"?`Daily at ${c.time ?? "09:00"}`:c.scheduleType==="hourly"?"Every hour":String(c.cron ?? "Advanced schedule")},
  {type:"file_watch_trigger",name:"File Watch Trigger",description:"Watch an approved folder",group:"Triggers",icon:FileClock,defaults:{folder:"",events:["created"],pattern:""},summary:c=>c.folder?`Watch ${String(c.folder).split(/[\\/]/).pop()}`:"Choose a folder"},
  {type:"gmail_new_email_trigger",name:"New Email",description:"Poll Gmail safely for matching messages",group:"Triggers",icon:Mail,defaults:{credentialId:"",pollIntervalMinutes:5,sender:"",recipient:"",subjectContains:"",hasAttachment:false,label:"",includeHtmlBody:false,markAsProcessed:"deduplicate"},summary:c=>c.credentialId?`Every ${c.pollIntervalMinutes??5} min · Gmail`:"Choose a Gmail connection"},
  {type:"condition",name:"Condition",description:"Follow a true or false branch",group:"Logic",icon:GitBranch,defaults:{left:"",operator:"equals",right:""},summary:c=>c.left?`${String(c.left)} · ${String(c.operator).replaceAll("_"," ")}`:"Configure comparison"},
  {type:"set_data",name:"Set Data",description:"Construct a structured object",group:"Data",icon:Braces,defaults:{values:{key:"value"}},summary:c=>`${Object.keys((c.values as object) ?? {}).length} field(s)`},
  {type:"delay",name:"Delay",description:"Wait without blocking the runner",group:"Logic",icon:Clock3,defaults:{amount:1,unit:"seconds"},summary:c=>`${c.amount ?? 1} ${c.unit ?? "seconds"}`},
  {type:"http_request",name:"HTTP Request",description:"Call an HTTP endpoint",group:"Network",icon:Globe2,defaults:{method:"GET",url:"",query:{},headers:{},body:null,timeoutMs:30000,retryCount:0},summary:c=>c.url?`${c.method ?? "GET"} ${c.url}`:"Enter a URL"},
  {type:"desktop_notification",name:"Desktop Notification",description:"Show a native notification",group:"System",icon:Bell,defaults:{title:"sndbox",message:"Workflow completed"},summary:c=>String(c.title || "Configure notification")},
  {type:"move_file",name:"Move File",description:"Move within approved folders",group:"System",icon:FileOutput,defaults:{source:"",destinationFolder:"",renameTo:"",overwrite:false},summary:c=>c.destinationFolder?`Move to ${String(c.destinationFolder).split(/[\\/]/).pop()}`:"Choose destination"},
  {type:"read_file",name:"Read File",description:"Read text from an approved file",group:"Data",icon:FileInput,defaults:{path:"",encoding:"utf8",maximumBytes:10485760},summary:c=>c.path?String(c.path).split(/[\\/]/).pop()!:"Choose a file"},
  {type:"write_file",name:"Write File",description:"Write text to an approved file",group:"System",icon:FilePlus2,defaults:{path:"",content:"",overwrite:false,createParents:false},summary:c=>c.path?String(c.path).split(/[\\/]/).pop()!:"Choose a file"},
  {type:"copy_path",name:"Copy File or Folder",description:"Copy within approved folders",group:"System",icon:Copy,defaults:{source:"",destination:"",overwrite:false},summary:c=>c.destination?`Copy to ${String(c.destination).split(/[\\/]/).pop()}`:"Choose destination"},
  {type:"delete_path",name:"Delete File or Folder",description:"Delete an explicitly approved path",group:"System",icon:Trash2,defaults:{path:"",recursive:false},summary:c=>c.path?`Delete ${String(c.path).split(/[\\/]/).pop()}`:"Choose a path"},
  {type:"list_folder",name:"List Folder",description:"List files in an approved folder",group:"Data",icon:ListTree,defaults:{folder:"",recursive:false,pattern:"*"},summary:c=>c.folder?`List ${String(c.folder).split(/[\\/]/).pop()}`:"Choose a folder"},
  {type:"parse_csv",name:"Parse CSV",description:"Parse CSV text or an approved file",group:"Data",icon:TableProperties,defaults:{path:"",content:"",delimiter:",",hasHeaders:true,trim:true},summary:c=>c.path?`Parse ${String(c.path).split(/[\\/]/).pop()}`:"Map CSV content or choose a file"},
  {type:"parse_json",name:"Parse JSON",description:"Parse JSON text or an approved file",group:"Data",icon:FileJson,defaults:{path:"",content:""},summary:c=>c.path?`Parse ${String(c.path).split(/[\\/]/).pop()}`:"Map JSON content or choose a file"},
  {type:"parse_text",name:"Parse Text",description:"Split text into lines and basic statistics",group:"Data",icon:FileText,defaults:{path:"",content:"",trim:true,removeEmptyLines:false},summary:c=>c.path?`Parse ${String(c.path).split(/[\\/]/).pop()}`:"Map text or choose a file"},
  {type:"get_workflow_state",name:"Get Workflow State",description:"Read a value stored by this workflow",group:"Data",icon:Database,defaults:{key:"",defaultValue:null},summary:c=>c.key?`Read ${String(c.key)}`:"Choose a state key"},
  {type:"set_workflow_state",name:"Set Workflow State",description:"Store a value after a successful run",group:"Data",icon:Database,defaults:{key:"",value:null},summary:c=>c.key?`Store ${String(c.key)}`:"Choose a state key"},
  {type:"compare_previous",name:"Compare With Previous",description:"Detect a meaningful change and update state after success",group:"Logic",icon:GitCompare,defaults:{key:"",value:null,normalization:"trim"},summary:c=>c.key?`Compare ${String(c.key)}`:"Choose a state key"},
  {type:"run_command",name:"Run Command",description:"Execute an explicitly approved process",group:"System",icon:Code2,defaults:{executable:"",arguments:[],workingDirectory:"",timeoutMs:30000},summary:c=>String(c.executable || "Approval required")},
  {type:"open_browser",name:"Open Browser",description:"Start a managed Chromium session",group:"Browser",icon:Globe2,defaults:{profileId:"",headed:true,initialUrl:"",viewport:{width:1280,height:800},defaultTimeoutMs:30000,closeAutomatically:true,keepOpenAfterManualTest:false,maximumDurationMs:1800000},summary:c=>c.profileId?`${c.headed===false?"Headless":"Headed"} · managed profile`:"Choose a browser profile"},
  {type:"navigate",name:"Navigate",description:"Load a URL in the active session",group:"Browser",icon:Navigation,defaults:{url:"",waitCondition:"dom_ready",timeoutMs:30000},summary:c=>String(c.url||"Enter a URL")},
  {type:"click_element",name:"Click Element",description:"Click a recorded element",group:"Browser",icon:MousePointerClick,defaults:{locator:null,clickType:"normal",mouseButton:"left",modifiers:[],waitAfterMs:0,timeoutMs:30000},summary:c=>locatorSummary(c,"Choose a target")},
  {type:"fill_field",name:"Fill Field",description:"Enter static or protected data",group:"Browser",icon:LogIn,defaults:{locator:null,value:"",clearExisting:true,inputDelayMs:0,sensitive:false,timeoutMs:30000},summary:c=>locatorSummary(c,c.sensitive?"Protected value":"Configure field")},
  {type:"select_option",name:"Select Option",description:"Choose an option by value, label or index",group:"Browser",icon:MousePointerClick,defaults:{locator:null,selectBy:"value",option:"",timeoutMs:30000},summary:c=>`${String(c.selectBy??"value")}: ${String(c.option??"")||"choose option"}`},
  {type:"press_key",name:"Press Key",description:"Send a validated key combination",group:"Browser",icon:Keyboard,defaults:{key:"Enter",timeoutMs:30000},summary:c=>String(c.key||"Enter")},
  {type:"wait_for",name:"Wait For",description:"Wait for page state or an element",group:"Browser",icon:Clock3,defaults:{waitFor:"element_visible",locator:null,delayMs:1000,timeoutMs:30000},summary:c=>String(c.waitFor??"element visible").replaceAll("_"," ")},
  {type:"extract_data",name:"Extract Data",description:"Extract structured values from the page",group:"Browser",icon:ScanSearch,defaults:{locator:null,extract:"text",fieldName:"value",repeated:false,fields:{},timeoutMs:30000},summary:c=>`${String(c.fieldName??"value")} · ${String(c.extract??"text").replaceAll("_"," ")}`},
  {type:"screenshot",name:"Screenshot",description:"Capture viewport, page or element",group:"Browser",icon:Camera,defaults:{mode:"viewport",includeInHistory:true,maximumBytes:10485760,timeoutMs:30000},summary:c=>String(c.mode??"viewport").replaceAll("_"," ")},
  {type:"download_file",name:"Download File",description:"Save a browser download safely",group:"Browser",icon:Download,defaults:{locator:null,destinationFolder:"",filename:"",collisionBehaviour:"rename",maximumBytes:104857600,timeoutMs:60000},summary:c=>c.destinationFolder?`Save to ${String(c.destinationFolder).split(/[\\/]/).pop()}`:"Choose destination"},
  {type:"upload_file",name:"Upload File",description:"Upload an approved local file",group:"Browser",icon:Upload,defaults:{locator:null,file:"",timeoutMs:30000},summary:c=>c.file?String(c.file).split(/[\\/]/).pop()!:"Choose an approved file"},
  {type:"close_browser",name:"Close Browser",description:"Close the active managed session",group:"Browser",icon:X,defaults:{},summary:()=>"Close browser session"},
  {type:"gmail_get_email",name:"Get Email",description:"Retrieve a Gmail message",group:"Communication",icon:Mail,defaults:{credentialId:"",messageId:""},summary:c=>c.credentialId?"Retrieve Gmail message":"Choose a Gmail connection"},
  {type:"gmail_create_draft",name:"Create Gmail Draft",description:"Create an editable draft without sending",group:"Communication",icon:MailPlus,defaults:{credentialId:"",to:"",cc:"",bcc:"",subject:"",body:"",htmlBody:"",replyToMessage:""},summary:c=>c.to?`Draft to ${c.to}`:"Configure draft"},
  {type:"gmail_send_email",name:"Send Email",description:"Send only after explicit workflow approval",group:"Communication",icon:Send,defaults:{credentialId:"",to:"",cc:"",bcc:"",subject:"",body:"",htmlBody:"",replyToMessage:"",attachments:[]},summary:c=>c.to?`Send to ${c.to}`:"Approval required"},
  {type:"gmail_add_label",name:"Add Gmail Label",description:"Add or remove message labels",group:"Communication",icon:Tag,defaults:{credentialId:"",messageId:"",addLabelIds:[],removeLabelIds:[]},summary:c=>c.messageId?"Modify Gmail labels":"Choose a message"},
  {type:"discord_webhook",name:"Discord Webhook",description:"Send a webhook message",group:"Communication",icon:MessageSquare,defaults:{credentialId:"",content:"",username:"",avatarUrl:""},summary:c=>c.credentialId?"Send Discord message":"Choose a connection"},
  {type:"discord_embed",name:"Discord Embed",description:"Send a structured webhook embed",group:"Communication",icon:MessageSquare,defaults:{credentialId:"",content:"",title:"",description:"",fields:[],color:5793266,link:"",image:""},summary:c=>String(c.title||"Configure Discord embed")},
  {type:"slack_webhook",name:"Slack Webhook",description:"Send an incoming webhook message",group:"Communication",icon:MessageSquare,defaults:{credentialId:"",content:""},summary:c=>c.credentialId?"Send Slack message":"Choose a connection"},
  {type:"approval",name:"Manual Approval",description:"Pause for local review",group:"Logic",icon:ShieldQuestion,defaults:{proposedAction:"",recipient:"",subject:"",messagePreview:"",attachments:[],expiresInMinutes:60},summary:c=>String(c.proposedAction||"Approval required")},
];
const NODE_PORTS:Partial<Record<BuiltInNodeType,{inputs:NodePortDefinition[];outputs:NodePortDefinition[]}>>={
  manual_trigger:{inputs:[],outputs:[{key:"event",label:"Event",type:"object"}]},
  schedule_trigger:{inputs:[],outputs:[{key:"event",label:"Schedule event",type:"object"}]},
  file_watch_trigger:{inputs:[],outputs:[{key:"event",label:"File event",type:"object"}]},
  gmail_new_email_trigger:{inputs:[],outputs:[{key:"email",label:"Email",type:"object"}]},
  condition:{inputs:[{key:"left",label:"Value",type:"any",required:true},{key:"right",label:"Compare with",type:"any"}],outputs:[{key:"result",label:"Result",type:"boolean"}]},
  set_data:{inputs:[{key:"values",label:"Object",type:"object"}],outputs:[{key:"value",label:"Object",type:"object"}]},
  http_request:{inputs:[{key:"url",label:"URL",type:"string",required:true},{key:"body",label:"Body",type:"any"}],outputs:[{key:"status",label:"Status",type:"number"},{key:"body",label:"Body",type:"any"},{key:"finalUrl",label:"Final URL",type:"string"}]},
  extract_data:{inputs:[],outputs:[{key:"value",label:"Extracted value",type:"any"}]},
  download_file:{inputs:[],outputs:[{key:"path",label:"Downloaded path",type:"path"},{key:"bytes",label:"Bytes",type:"number"}]},
  screenshot:{inputs:[],outputs:[{key:"path",label:"Screenshot path",type:"path"}]},
  run_command:{inputs:[{key:"arguments",label:"Arguments",type:"array"}],outputs:[{key:"stdout",label:"Standard output",type:"string"},{key:"stderr",label:"Standard error",type:"string"},{key:"exitCode",label:"Exit code",type:"number"}]},
  read_file:{inputs:[{key:"path",label:"File path",type:"path",required:true}],outputs:[{key:"content",label:"Content",type:"string"},{key:"path",label:"Path",type:"path"},{key:"bytes",label:"Bytes",type:"number"}]},
  write_file:{inputs:[{key:"path",label:"File path",type:"path",required:true},{key:"content",label:"Content",type:"string",required:true}],outputs:[{key:"path",label:"Path",type:"path"},{key:"bytes",label:"Bytes",type:"number"}]},
  list_folder:{inputs:[{key:"folder",label:"Folder",type:"path",required:true}],outputs:[{key:"entries",label:"Entries",type:"array"},{key:"count",label:"Count",type:"number"}]},
  parse_csv:{inputs:[{key:"path",label:"CSV file",type:"path"},{key:"content",label:"CSV text",type:"string"}],outputs:[{key:"headers",label:"Headers",type:"array"},{key:"rows",label:"Rows",type:"array"},{key:"rowCount",label:"Row count",type:"number"}]},
  parse_json:{inputs:[{key:"path",label:"JSON file",type:"path"},{key:"content",label:"JSON text",type:"string"}],outputs:[{key:"value",label:"Value",type:"any"}]},
  parse_text:{inputs:[{key:"path",label:"Text file",type:"path"},{key:"content",label:"Text",type:"string"}],outputs:[{key:"text",label:"Text",type:"string"},{key:"lines",label:"Lines",type:"array"},{key:"lineCount",label:"Line count",type:"number"}]},
  get_workflow_state:{inputs:[{key:"key",label:"Key",type:"string",required:true}],outputs:[{key:"value",label:"Value",type:"any"},{key:"found",label:"Found",type:"boolean"}]},
  set_workflow_state:{inputs:[{key:"key",label:"Key",type:"string",required:true},{key:"value",label:"Value",type:"any",required:true}],outputs:[{key:"value",label:"Stored value",type:"any"}]},
  compare_previous:{inputs:[{key:"key",label:"Key",type:"string",required:true},{key:"value",label:"Current value",type:"any",required:true}],outputs:[{key:"changed",label:"Changed",type:"boolean"},{key:"previous",label:"Previous",type:"any"},{key:"current",label:"Current",type:"any"}]},
};
const SIDE_EFFECTS=new Set<NodeType>(["desktop_notification","move_file","write_file","copy_path","delete_path","run_command","gmail_create_draft","gmail_send_email","gmail_add_label","discord_webhook","discord_embed","slack_webhook","approval","set_workflow_state","compare_previous"]);
const BROWSER_TYPES=new Set<NodeType>(["open_browser","navigate","click_element","fill_field","select_option","press_key","wait_for","extract_data","screenshot","download_file","upload_file","close_browser"]);
const normalizeDefinition=(definition:NodeDefinitionInput):NodeDefinition=>{const contract=NODE_PORTS[definition.type as BuiltInNodeType];return{...definition,inputs:definition.inputs??contract?.inputs??[],outputs:definition.outputs??contract?.outputs??[{key:"result",label:"Result",type:"any"}],sideEffect:definition.sideEffect??SIDE_EFFECTS.has(definition.type),placements:definition.placements??(BROWSER_TYPES.has(definition.type)?["local","paired_runner","managed_browser"]:["local","paired_runner","hosted_runner"])}};
export const NODE_DEFINITIONS:NodeDefinition[]=BASE_NODE_DEFINITIONS.map(normalizeDefinition);
const UNKNOWN_PLUGIN_DEFINITION:NodeDefinition={type:"unknown.plugin",name:"Plugin node",description:"Pinned third-party node",group:"Plugins",icon:Blocks,defaults:{},summary:()=>"Pinned sandbox plugin",inputs:[],outputs:[{key:"result",label:"Result",type:"any"}],sideEffect:true,placements:["local","paired_runner","hosted_runner"]};
const PLUGIN_DEFINITIONS=new Map<NodeType,NodeDefinition>();
const PLUGIN_TRIGGERS=new Set<NodeType>();
export const definitionFor=(type:NodeType)=>NODE_DEFINITIONS.find(item=>item.type===type)??PLUGIN_DEFINITIONS.get(type)??{...UNKNOWN_PLUGIN_DEFINITION,type};
export const createNode=(type:NodeType,position:{x:number;y:number}):WorkflowNode=>{const definition=definitionFor(type);return{id:`${type}_${crypto.randomUUID().slice(0,8)}`,type,version:1,name:definition.name,position,configuration:structuredClone(definition.defaults),disabled:false,inputBindings:{}}};
export const createPluginNode=(choice:PluginNodeChoice,position:{x:number;y:number}):WorkflowNode=>({
  id:`plugin_${crypto.randomUUID().slice(0,8)}`,
  type:choice.node.nodeType,
  version:choice.node.nodeVersion,
  name:choice.node.displayName,
  position,
  configuration:defaultsFromSchema(choice.node.configurationSchema),
  disabled:false,
  inputBindings:{},
  plugin:{pluginId:choice.plugin.pluginId,pluginVersion:choice.plugin.version,packageIntegrity:choice.plugin.packageIntegrity,publisherId:choice.plugin.publisherId,input:{},credentialReferences:{}},
});
export const enabledPluginNodes=(plugins:InstalledPlugin[]):PluginNodeChoice[]=>plugins.filter(plugin=>plugin.state==="enabled").flatMap(plugin=>plugin.manifest.nodes.map(node=>{
  const trigger=node.kind==="polling_trigger";
  if(trigger)PLUGIN_TRIGGERS.add(node.nodeType);
  const placements:NodePlacement[]=(node.placements??["desktop","self_hosted"]).flatMap(value=>value==="desktop"?["local"]:value==="self_hosted"?["paired_runner"]:[]);
  PLUGIN_DEFINITIONS.set(node.nodeType,{type:node.nodeType,name:node.displayName,description:node.description,group:trigger?"Triggers":"Plugins",icon:Blocks,defaults:defaultsFromSchema(node.configurationSchema),summary:config=>String(config.repository??config.channelId??config.dataSourceId??config.spreadsheetId??(config.connectionId?"Connection selected":"Configure node")),inputs:node.inputPorts??[],outputs:node.outputPorts??[{key:"result",label:"Result",type:"any"}],sideEffect:node.externalEffect!=="read",placements:placements.length?placements:["local","paired_runner"],configurationSchema:node.configurationSchema,connectionRequirements:node.connectionRequirements,fileInputs:node.fileInputs,externalEffect:node.externalEffect});
  return{plugin,node};
}));
export const isTrigger=(type:NodeType)=>["manual_trigger","schedule_trigger","file_watch_trigger","gmail_new_email_trigger"].includes(type)||PLUGIN_TRIGGERS.has(type);
const locatorSummary=(config:Record<string,unknown>,fallback:string)=>{const locator=config.locator as {accessibleName?:string;primary?:{name?:string;value?:string}}|undefined;return locator?.accessibleName||locator?.primary?.name||locator?.primary?.value||fallback};
function defaultsFromSchema(schema:Record<string,unknown>):Record<string,unknown>{
  if(schema.default&&typeof schema.default==="object"&&!Array.isArray(schema.default))return structuredClone(schema.default as Record<string,unknown>);
  const result:Record<string,unknown>={};
  const properties=(schema.properties&&typeof schema.properties==="object"?schema.properties:{}) as Record<string,Record<string,unknown>>;
  for(const [key,property] of Object.entries(properties)){
    if("default" in property)result[key]=structuredClone(property.default);
    else if(property.type==="object")result[key]=defaultsFromSchema(property);
    else if(property.type==="array")result[key]=[];
  }
  return result;
}
