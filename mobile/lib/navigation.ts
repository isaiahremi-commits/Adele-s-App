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
  };
};
