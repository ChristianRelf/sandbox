import { CircleCheck, CircleDashed, CircleX, Clock3, LoaderCircle, MinusCircle, OctagonX } from "lucide-react";
import type { ExecutionStatus, NodeStatus } from "../types";
const icons={idle:CircleDashed,waiting:Clock3,running:LoaderCircle,successful:CircleCheck,failed:CircleX,skipped:MinusCircle,cancelled:OctagonX,queued:Clock3};
export function Status({status,label=true}:{status:NodeStatus|ExecutionStatus;label?:boolean}){const Icon=icons[status];return <span className={`status status-${status}`}><Icon size={13} className={status==="running"?"spin":""}/>{label&&<span>{status}</span>}</span>}
