import type { PtoRequest } from "./pto";

// Param lists that both App.tsx (navigator setup) and screens (typed
// navigation/route hooks) need — kept here so screens never import App.tsx.

export type PtoStackParamList = {
  PtoList: undefined;
  PtoDetail: { request: PtoRequest };
};

export type ScheduleStackParamList = {
  ScheduleList: undefined;
  TipDeclaration: {
    outletId: string;
    outletName: string | null;
    shiftDate: string; // "yyyy-MM-dd"
    position: string | null;
    // PR #28: outlet's tip mode when known — 'no_tips' renders the
    // read-only "doesn't track tips" state without waiting on the RPC.
    tipPoolMode?: string | null;
  };
  SwapRequest: {
    shiftId: string;
    shiftDate: string; // "yyyy-MM-dd"
    startTime: string | null;
    endTime: string | null;
    position: string | null;
    outletName: string | null;
  };
};
