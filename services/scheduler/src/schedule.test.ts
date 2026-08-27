import { describe,expect,it } from "vitest";
import { deterministicJitterMs,misfireOutcome,nextOccurrences,retryBackoffMs,type ScheduleDefinition } from "./schedule.js";
const calendar=(dstPolicy:ScheduleDefinition["dstPolicy"]):ScheduleDefinition=>({scheduleId:"10000000-0000-4000-8000-000000000001",timeZone:"Europe/London",dstPolicy,startAt:null,endAt:null,jitterSeconds:0,schedule:{type:"calendar",spec:{hour:1,minute:30,daysOfWeek:[0,1,2,3,4,5,6]}}});
describe("schedule calculation",()=>{
  it("calculates interval schedules from a stable anchor",()=>{const dates=nextOccurrences({scheduleId:"interval",timeZone:"UTC",dstPolicy:"run_once",startAt:null,endAt:null,jitterSeconds:0,schedule:{type:"interval",spec:{everySeconds:300,anchorAt:"2026-01-01T00:00:00.000Z"}}},new Date("2026-01-01T00:07:00.000Z"),2);expect(dates.map(date=>date.toISOString())).toEqual(["2026-01-01T00:10:00.000Z","2026-01-01T00:15:00.000Z"]);});
  it("skips a nonexistent daylight-saving wall time",()=>{const [next]=nextOccurrences(calendar("skip"),new Date("2026-03-28T23:00:00.000Z"),1);expect(next.toISOString()).toBe("2026-03-30T00:30:00.000Z");});
  it("makes jitter and retry backoff deterministic and bounded",()=>{const date=new Date("2026-01-01T00:00:00Z");expect(deterministicJitterMs("schedule",date,60)).toBe(deterministicJitterMs("schedule",date,60));expect(deterministicJitterMs("schedule",date,60)).toBeLessThanOrEqual(60_000);expect(retryBackoffMs(3,"event")).toBeGreaterThanOrEqual(1_000);expect(retryBackoffMs(3,"event")).toBeLessThanOrEqual(4_000);});
  it("applies explicit misfire policies",()=>{const due=new Date("2026-01-01T00:00:00Z"),now=new Date("2026-01-01T00:10:00Z");expect(misfireOutcome(due,now,60,"skip")).toBe("skip");expect(misfireOutcome(due,new Date("2026-01-01T00:00:30Z"),60,"skip")).toBe("queue");});
});

