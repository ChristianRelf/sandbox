import { describe,expect,it } from "vitest";
import { BrowserNetworkPolicy,isBlockedAddress } from "./network-policy.js";
import { validateProfileImport } from "./profiles.js";

describe("managed browser boundaries",()=>{
  it.each(["127.0.0.1","169.254.169.254","10.0.0.1","172.31.2.3","192.168.1.1","100.64.0.1","::1","fd00::1","fe80::1"])("blocks internal address %s",address=>expect(isBlockedAddress(address)).toBe(true));
  it("resolves hostnames for every decision and blocks DNS answers into private space",async()=>{let resolutions=0;const policy=new BrowserNetworkPolicy(async()=>{resolutions++;return resolutions===1?["203.0.113.10"]:["10.0.0.5"];});expect((await policy.inspect("https://example.test/report")).allowed).toBe(true);expect(await policy.inspect("https://example.test/redirect")).toMatchObject({allowed:false,reason:"private_or_internal_address"});expect(resolutions).toBe(2);});
  it.each(["file:///etc/passwd","javascript:alert(1)","http://metadata.google.internal/latest","http://localhost:3000"])("blocks dangerous target %s",async target=>expect((await new BrowserNetworkPolicy().inspect(target)).allowed).toBe(false));
  it("requires an explicit password-free cloud profile import",()=>{expect(()=>validateProfileImport({source:"explicit_local_export",workspaceId:"10000000-0000-4000-8000-000000000001",expiresAt:"2027-01-01T00:00:00.000Z",summary:{cookieCount:2,localStorageOrigins:1,browserPermissions:[],containsSavedPasswords:true},encryptedArchiveReference:"object://profile",securityWarningAccepted:true,reauthenticationRecommended:true},new Date("2026-01-01"))).toThrow();});
});
