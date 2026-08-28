import {describe,expect,it} from "vitest";
import {DATA_CLASSIFICATION,validateRetentionPolicy} from "./privacy.js";

describe("privacy controls",()=>{
  it("classifies every sensitive control-plane data family",()=>{expect(DATA_CLASSIFICATION).toMatchObject({account_identity:{classification:"personal"},authentication:{classification:"secret"},workflow_content:{classification:"customer_content"},execution_detail:{classification:"customer_content"},webhook_payload:{classification:"customer_content"},operational_evidence:{classification:"security_record"},billing_record:{classification:"financial_record"}});});
  it("enforces bounded retention including the audit minimum",()=>{const policy={executionDetailDays:90,queueEventDays:30,webhookDeliveryDays:7,runnerCommandDays:30,auditEventDays:2555};expect(()=>validateRetentionPolicy(policy)).not.toThrow();expect(()=>validateRetentionPolicy({...policy,webhookDeliveryDays:31})).toThrow(/webhookDeliveryDays/);expect(()=>validateRetentionPolicy({...policy,auditEventDays:30})).toThrow(/auditEventDays/);});
});
