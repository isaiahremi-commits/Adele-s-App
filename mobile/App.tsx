import {
  DefaultTheme,
  NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import {
  ElmsSans_400Regular,
  ElmsSans_500Medium,
  ElmsSans_600SemiBold,
  ElmsSans_700Bold,
} from "@expo-google-fonts/elms-sans";
import {
  CrimsonText_400Regular,
  CrimsonText_400Regular_Italic,
} from "@expo-google-fonts/crimson-text";
import { createContext,
  useContext,
  useEffect,
  useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { Text } from "./components/Text";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { InboxProvider } from "./contexts/InboxContext";
import InboxBell from "./components/InboxBell";
import { ToastHost } from "./components/Toast";
import TosAcceptanceModal from "./components/TosAcceptanceModal";
import { isManager } from "./lib/manager";
import { colors, fontFamilies } from "./lib/theme";
import type {
  PtoStackParamList,
  ScheduleStackParamList,
} from "./lib/navigation";
import BroadcastDetailScreen from "./screens/BroadcastDetailScreen";
import ChangePasswordScreen from "./screens/ChangePasswordScreen";
import ComposeBroadcastScreen from "./screens/ComposeBroadcastScreen";
import HomeScreen from "./screens/HomeScreen";
import InboxScreen from "./screens/InboxScreen";
import LoginScreen from "./screens/LoginScreen";
import ManagerInboxScreen from "./screens/ManagerInboxScreen";
import EndOfDayScreen from "./screens/manager/EndOfDayScreen";
import WorkHoursScreen from "./screens/manager/WorkHoursScreen";
import WorkSalesScreen from "./screens/manager/WorkSalesScreen";
import WorkTeamScreen from "./screens/manager/WorkTeamScreen";
import NoTenantScreen from "./screens/NoTenantScreen";
import PayScreen from "./screens/PayScreen";
import PtoDetailScreen from "./screens/PtoDetailScreen";
import PtoScreen from "./screens/PtoScreen";
import ScheduleScreen from "./screens/ScheduleScreen";
import SelfOnboardingScreen from "./screens/SelfOnboardingScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SwapRequestScreen from "./screens/SwapRequestScreen";
import TipDeclarationScreen from "./screens/TipDeclarationScreen";

export type RootStackParamList = {
  Login: undefined;
  NoTenant: undefined;
  ChangePassword: undefined;
  TosAcceptance: undefined;
  SelfOnboarding: undefined;
  Main: undefined;
  Inbox: undefined;
  BroadcastDetail: { broadcastId: string };
  ComposeBroadcast: undefined;
  Approvals: undefined;
};

export type MainTabParamList = {
  Home: undefined;
  Schedule: undefined;
  Pto: undefined;
  Pay: undefined;
  Settings: undefined;
};

export type WorkTabParamList = {
  Team: undefined;
  Hours: undefined;
  Sales: undefined;
  EndOfDay: undefined;
  Settings: undefined;
};

// Brand navigation theme — cream canvas, white chrome, apricot accents.
// Passing it at the container level themes screen backgrounds (no white
// flashes against cream) and every default header/tab surface at once.
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.card,
    text: colors.foreground,
    border: colors.border,
    notification: colors.primary,
  },
  fonts: {
    regular: { fontFamily: fontFamilies.regular, fontWeight: "400" as const },
    medium: { fontFamily: fontFamilies.medium, fontWeight: "500" as const },
    bold: { fontFamily: fontFamilies.semibold, fontWeight: "600" as const },
    heavy: { fontFamily: fontFamilies.bold, fontWeight: "700" as const },
  },
};

// Shared styling for the three native-stack navigators (root + nested):
// white header, chocolate title/back tint, brand semibold titles.
const stackScreenOptions = {
  headerStyle: { backgroundColor: colors.card },
  headerTintColor: colors.foreground,
  headerTitleStyle: {
    color: colors.foreground,
    fontFamily: fontFamilies.semibold,
  },
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const WorkTab = createBottomTabNavigator<WorkTabParamList>();
const PtoStackNav = createNativeStackNavigator<PtoStackParamList>();
const ScheduleStackNav = createNativeStackNavigator<ScheduleStackParamList>();

// Manager Work/Personal mode (PR #18), remembered across launches. The
// toggle renders INLINE in each header's left slot (one standard-height
// navbar row: [toggle] [title] [bell]) — a context carries the mode state
// down so the nested Schedule/PTO stack headers can host it too.
const MODE_KEY = "manadele_mode";
type Mode = "personal" | "work";

const ModeContext = createContext<{
  isMgr: boolean;
  mode: Mode;
  switchMode: (m: Mode) => void;
}>({ isMgr: false, mode: "personal", switchMode: () => {} });

/** Compact Personal|Work segmented control for header-left. Renders
 * nothing for non-managers, so their headers are untouched. */
function ModeToggle() {
  const { isMgr, mode, switchMode } = useContext(ModeContext);
  if (!isMgr) return null;
  return (
    <View style={styles.modeToggle}>
      {(
        [
          { key: "personal", label: "Personal" },
          { key: "work", label: "Work" },
        ] as const
      ).map((opt) => (
        <Pressable
          key={opt.key}
          style={[
            styles.modeSegment,
            mode === opt.key && styles.modeSegmentActive,
          ]}
          onPress={() => switchMode(opt.key)}
        >
          <Text
            style={[
              styles.modeSegmentText,
              mode === opt.key && styles.modeSegmentTextActive,
            ]}
          >
            {opt.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

// Schedule gets its own stack so the tip-declaration screen has a native
// back header (same pattern as the PTO stack).
function ScheduleStack() {
  return (
    <ScheduleStackNav.Navigator screenOptions={stackScreenOptions}>
      <ScheduleStackNav.Screen
        name="ScheduleList"
        component={ScheduleScreen}
        options={{
          title: "Schedule",
          headerTitleAlign: "center",
          headerLeft: () => <ModeToggle />,
          headerRight: () => <InboxBell />,
        }}
      />
      <ScheduleStackNav.Screen
        name="TipDeclaration"
        component={TipDeclarationScreen}
        options={{ title: "Declare Tips" }}
      />
      <ScheduleStackNav.Screen
        name="SwapRequest"
        component={SwapRequestScreen}
        options={{ title: "Request Swap" }}
      />
    </ScheduleStackNav.Navigator>
  );
}

// PTO gets its own stack so the detail screen has a native back header.
function PtoStack() {
  return (
    <PtoStackNav.Navigator screenOptions={stackScreenOptions}>
      <PtoStackNav.Screen
        name="PtoList"
        component={PtoScreen}
        options={{
          title: "PTO",
          headerTitleAlign: "center",
          headerLeft: () => <ModeToggle />,
          headerRight: () => <InboxBell />,
        }}
      />
      <PtoStackNav.Screen
        name="PtoDetail"
        component={PtoDetailScreen}
        options={{ title: "PTO Request" }}
      />
    </PtoStackNav.Navigator>
  );
}

const tabScreenOptions = {
  tabBarActiveTintColor: colors.primary,
  // Brand spec: 60% swiss chocolate for inactive tabs (not the 50% muted).
  tabBarInactiveTintColor: colors.mutedStrong,
  tabBarStyle: {
    backgroundColor: colors.card,
    borderTopColor: colors.border,
  },
  // PR #19: descenders were clipping ("Pay" → "Pav", "Settings" →
  // "Settina") — smaller size + explicit lineHeight gives them room.
  tabBarLabelStyle: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: fontFamilies.medium,
  },
  headerStyle: { backgroundColor: colors.card },
  headerTitleStyle: {
    color: colors.foreground,
    fontFamily: fontFamilies.semibold,
  },
  headerTitleAlign: "center" as const,
  // One navbar row: [Personal|Work toggle] [title] [bell]. The toggle is a
  // no-op render for non-managers; the bell (PR #11) lives in every
  // header. Tabs with their own stacks (Schedule, PTO) set the same trio
  // on their root screens instead.
  headerLeft: () => <ModeToggle />,
  headerRight: () => <InboxBell />,
};

// Personal mode (every employee, and managers on the Personal side):
// Home / Schedule / PTO / Pay / Settings (PR #18 order).
function PersonalTabs() {
  return (
    <Tab.Navigator screenOptions={tabScreenOptions}>
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Schedule"
        component={ScheduleStack}
        options={{
          headerShown: false, // the Schedule stack renders its own headers
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Pto"
        component={PtoStack}
        options={{
          title: "PTO",
          headerShown: false, // the PTO stack renders its own headers
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Pay"
        component={PayScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cash-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// Work mode (managers only): Team / Hours / Sales / End of day / Settings.
// The full Approvals inbox (PR #10) rides the root stack, reached from the
// Team screen — deliberately not a 6th tab.
function WorkTabs() {
  // Header titles stay SINGLE-WORD — they share the row with the
  // Personal|Work toggle and the bell, and anything longer collides at
  // narrow widths. Date/context lines live in each screen's body.
  return (
    <WorkTab.Navigator screenOptions={tabScreenOptions}>
      <WorkTab.Screen
        name="Team"
        component={WorkTeamScreen}
        options={{
          title: "Team",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <WorkTab.Screen
        name="Hours"
        component={WorkHoursScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <WorkTab.Screen
        name="Sales"
        component={WorkSalesScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" size={size} color={color} />
          ),
        }}
      />
      <WorkTab.Screen
        name="EndOfDay"
        component={EndOfDayScreen}
        options={{
          title: "End of day",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="moon-outline" size={size} color={color} />
          ),
        }}
      />
      <WorkTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </WorkTab.Navigator>
  );
}

// The signed-in shell. The Personal|Work toggle lives INSIDE each header
// (headerLeft, standard navbar height — no extra bar above the tabs); the
// last mode is remembered (AsyncStorage) and a cached "work" is honored
// only once manager status confirms.
function MainShell() {
  const { user } = useAuth();
  const [isMgr, setIsMgr] = useState(false);
  const [mode, setMode] = useState<Mode>("personal");

  useEffect(() => {
    let alive = true;
    if (user) {
      isManager(user.id).then((v) => {
        if (alive) setIsMgr(v);
      });
    } else {
      setIsMgr(false);
    }
    AsyncStorage.getItem(MODE_KEY)
      .then((v) => {
        if (alive && v === "work") setMode("work");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user]);

  function switchMode(next: Mode) {
    setMode(next);
    AsyncStorage.setItem(MODE_KEY, next).catch(() => {});
  }

  const working = isMgr && mode === "work";

  return (
    <ModeContext.Provider value={{ isMgr, mode, switchMode }}>
      {working ? <WorkTabs /> : <PersonalTabs />}
    </ModeContext.Provider>
  );
}

function RootNavigator() {
  const {
    session,
    loading,
    mustChangePassword,
    needsTosAcceptance,
    selfOnboardingNeeded,
    tenantId,
  } = useAuth();

  // Restoring the persisted session on boot — hold on a spinner so we never
  // flash Login for an already-signed-in user.
  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Gate order matters: password change, then T&C, then self-onboarding
  // (PR #18 — the employee's own personal file), then the tabs. The first
  // two clear user_metadata flags (USER_UPDATED re-renders this navigator);
  // self-onboarding clears via refreshSelfOnboarding after its RPC.
  return (
    <Stack.Navigator screenOptions={stackScreenOptions}>
      {!session ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : !tenantId ? (
        // Misprovisioned account (no user_metadata.tenant_id) — RLS returns
        // zero rows for it, so nothing downstream would work.
        <Stack.Screen
          name="NoTenant"
          component={NoTenantScreen}
          options={{ headerShown: false }}
        />
      ) : mustChangePassword ? (
        <Stack.Screen
          name="ChangePassword"
          component={ChangePasswordScreen}
          options={{ headerShown: false }}
        />
      ) : needsTosAcceptance ? (
        <Stack.Screen
          name="TosAcceptance"
          component={TosAcceptanceModal}
          options={{ headerShown: false }}
        />
      ) : selfOnboardingNeeded ? (
        <Stack.Screen
          name="SelfOnboarding"
          component={SelfOnboardingScreen}
          options={{ headerShown: false }}
        />
      ) : (
        <Stack.Group>
          <Stack.Screen
            name="Main"
            component={MainShell}
            options={{ headerShown: false }}
          />
          {/* Broadcast inbox + approvals ride ABOVE the tabs as pushed
              cards (not native modals — a pushed card keeps its back
              button on every platform incl. web). */}
          <Stack.Screen
            name="Inbox"
            component={InboxScreen}
            options={{ title: "Inbox" }}
          />
          <Stack.Screen
            name="BroadcastDetail"
            component={BroadcastDetailScreen}
            options={{ title: "Message" }}
          />
          <Stack.Screen
            name="ComposeBroadcast"
            component={ComposeBroadcastScreen}
            options={{ title: "New Broadcast" }}
          />
          <Stack.Screen
            name="Approvals"
            component={ManagerInboxScreen}
            options={{ title: "Approvals" }}
          />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  // Brand fonts gate the whole tree (same cream spinner as the session
  // restore) so no screen ever renders in the system font.
  const [fontsLoaded] = useFonts({
    ElmsSans_400Regular,
    ElmsSans_500Medium,
    ElmsSans_600SemiBold,
    ElmsSans_700Bold,
    CrimsonText_400Regular,
    CrimsonText_400Regular_Italic,
  });
  if (!fontsLoaded) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  return (
    <AuthProvider>
      <InboxProvider>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
          <ToastHost />
          <StatusBar style="dark" />
        </NavigationContainer>
      </InboxProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  // Header-left segmented control — compact enough that even the longest
  // single-word title ("End of day") clears it and the bell at 366px:
  // toggle ≈ 118px + bell ≈ 42px leaves >120px of centered title space.
  modeToggle: {
    flexDirection: "row",
    marginLeft: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.background,
    overflow: "hidden",
  },
  modeSegment: {
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  modeSegmentActive: {
    backgroundColor: colors.primarySoft,
  },
  modeSegmentText: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.muted,
  },
  modeSegmentTextActive: {
    color: colors.primaryDim,
  },
});
