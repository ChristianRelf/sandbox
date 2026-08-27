import { createHash } from "node:crypto";
import { Cron } from "croner";
import { z } from "zod";

const intervalSpecSchema=z.object({everySeconds:z.number().int().min(1).max(31_536_000),anchorAt:z.string().datetime()}).strict();
const calendarSpecSchema=z.object({hour:z.number().int().min(0).max(23),minute:z.number().int().min(0).max(59),daysOfWeek:z.array(z.number().int().min(0).max(6)).min(1).max(7)}).strict();
const cronSpecSchema=z.object({expression:z.string().min(5).max(200)}).strict();
export type ScheduleSpec={type:"interval";spec:z.infer<typeof intervalSpecSchema>}|{type:"calendar";spec:z.infer<typeof calendarSpecSchema>}|{type:"cron";spec:z.infer<typeof cronSpecSchema>};
export interface ScheduleDefinition {scheduleId:string;timeZone:string;dstPolicy:"skip"|"run_once"|"run_twice";startAt:Date|null;endAt:Date|null;schedule:ScheduleSpec;jitterSeconds:number}

export function nextOccurrences(definition:ScheduleDefinition,after:Date,count:number):Date[]{
  if(count<1||count>1_000)throw new Error("Occurrence count must be between 1 and 1000.");
  let dates:Date[];
  if(definition.schedule.type==="interval"){
    const spec=intervalSpecSchema.parse(definition.schedule.spec);const anchor=new Date(spec.anchorAt);const interval=spec.everySeconds*1_000;const first=Math.max(1,Math.floor((after.getTime()-anchor.getTime())/interval)+1);dates=Array.from({length:count},(_,index)=>new Date(anchor.getTime()+(first+index)*interval));
  }else{
    const pattern=definition.schedule.type==="cron"?cronSpecSchema.parse(definition.schedule.spec).expression:calendarPattern(calendarSpecSchema.parse(definition.schedule.spec));
    const cron=new Cron(pattern,{timezone:definition.timeZone,paused:true});
    dates=cron.nextRuns(Math.min(count*4,4_000),after);
    // Croner normalises nonexistent wall times across a spring-forward boundary.
    // A normalised instant no longer matches the expression in the target zone,
    // so discard it instead of silently running at a different local time.
    dates=dates.filter(date=>cron.match(date));
    if(definition.dstPolicy!=="run_twice"){
      const wallKeys=new Set<string>();dates=dates.filter(date=>{const key=wallClockKey(date,definition.timeZone);if(wallKeys.has(key))return false;wallKeys.add(key);return true;});
    }
    dates=dates.slice(0,count);
  }
  const start=definition.startAt?.getTime()??Number.NEGATIVE_INFINITY,end=definition.endAt?.getTime()??Number.POSITIVE_INFINITY;
  return dates.filter(date=>date.getTime()>=start&&date.getTime()<=end).map(date=>new Date(date.getTime()+deterministicJitterMs(definition.scheduleId,date,definition.jitterSeconds)));
}

export function deterministicJitterMs(scheduleId:string,scheduledFor:Date,maximumSeconds:number):number{if(maximumSeconds<=0)return 0;const digest=createHash("sha256").update(scheduleId).update(scheduledFor.toISOString()).digest();return digest.readUInt32BE(0)%(maximumSeconds*1_000+1);}
export function retryBackoffMs(attempt:number,eventId:string,baseMs=1_000,maximumMs=3_600_000):number{const exponent=Math.min(Math.max(attempt-1,0),20);const ceiling=Math.min(baseMs*2**exponent,maximumMs);const digest=createHash("sha256").update(eventId).update(String(attempt)).digest();return Math.max(baseMs,Math.floor(ceiling/2)+(digest.readUInt32BE(0)%Math.max(1,Math.floor(ceiling/2))));}
export function misfireOutcome(scheduledFor:Date,now:Date,graceSeconds:number,policy:"queue"|"skip"|"expire"|"fallback_pool"):"queue"|"skip"|"expire"|"fallback_pool"{return now.getTime()-scheduledFor.getTime()<=graceSeconds*1_000?"queue":policy;}
function calendarPattern(spec:z.infer<typeof calendarSpecSchema>):string{return `${spec.minute} ${spec.hour} * * ${[...new Set(spec.daysOfWeek)].sort().join(",")}`;}
function wallClockKey(date:Date,timeZone:string):string{return new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).format(date);}
