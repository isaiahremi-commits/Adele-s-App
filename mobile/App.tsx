import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { InboxProvider } from "./contexts/InboxContext";
import InboxBell from "./components/InboxBell";
import { ToastHost } from "./components/Toast";
import TosAcceptanceModal from "./components/TosAcceptanceModal";
import { isManager } from "./lib/manager";
import { colors } from "./lib/theme";
import type {
  PtoStackParamList,
  ScheduleStackParamList,
} from "./lib/navigation";
import BroadcastDetailScreen from "./screens/BroadcastDetailScreen";
import ChangePasswordScreen from "./screens/ChangePasswordScreen";
import ComposeBroadcastScreen from "./screens/ComposeBroadcastScreen";
import InboxScreen from "./screens/InboxScreen";
import LoginScreen from "./screens/LoginScreen";
import ManagerInboxScreen from "./screens/ManagerInboxScreen";
import NoTenantScreen from "./screens/NoTenantScreen";
import PayScreen from "./screens/PayScreen";
import PtoDetailScreen from "./screens/PtoDetailScreen";
import PtoScreen from "./screens/PtoScreen";
import ScheduleScreen from "./screens/ScheduleScreen";
import SettingsScreen from "./screens/SettingsScreen";
import SwapRequestScreen from "./screens/SwapRequestScreen";
import TipDeclarationScreen from "./screens/TipDeclarationScreen";

export type RootStackParamList = {
  Login: undefined;
  NoTenant: undefined;
  ChangePassword: undefined;
  TosAcceptance: undefined;
  Main: undefined;
  Inbox: undefined;
  BroadcastDetail: { broadcastId: string };
  ComposeBroadcast: undefined;
};

export type MainTabParamList = {
  Schedule: undefined;
  Pto: undefined;
  Pay: undefined;
  Approvals: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();
const PtoStackNav = createNativeStackNavigator<PtoStackParamList>();
const ScheduleStackNav = createNativeStackNavigator<ScheduleStackParamList>();

// One header recipe for every navigator (tabs + both stacks + root cards)
// so titles can't drift in size/weight between screens.
const headerOptions = {
  headerTitleStyle: {
    color: colors.foreground,
    fontSize: 17,
    fontWeight: "600" as const,
  },
  headerTintColor: colors.primary,
};

// Schedule gets its own stack so the tip-declaration screen has a native
// back header (same pattern as the PTO stack).
function ScheduleStack() {
  return (
    <ScheduleStackNav.Navigator screenOptions={headerOptions}>
      <ScheduleStackNav.Screen
        name="ScheduleList"
        component={ScheduleScreen}
        options={{ title: "Schedule", headerRight: () => <InboxBell /> }}
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
    <PtoStackNav.Navigator screenOptions={headerOptions}>
      <PtoStackNav.Screen
        name="PtoList"
        component={PtoScreen}
        options={{ title: "PTO", headerRight: () => <InboxBell /> }}
      />
      <PtoStackNav.Screen
        name="PtoDetail"
        component={PtoDetailScreen}
        options={{ title: "PTO Request" }}
      />
    </PtoStackNav.Navigator>
  );
}

// The signed-in shell: bottom tabs. Tips (and any later tabs) land in
// future PRs.
function MainTabs() {
  const { user } = useAuth();
  // The Approvals tab renders only for Restaurant Managers. Checked once per
  // session via am_i_a_manager (cached per user in lib/manager); the RPCs
  // behind the tab re-verify manager status server-side regardless, so this
  // gate is purely cosmetic. Pre-012 (RPC missing) reads as false.
  const [showApprovals, setShowApprovals] = useState(false);
  useEffect(() => {
    let alive = true;
    if (user) {
      isManager(user.id).then((v) => {
        if (alive) setShowApprovals(v);
      });
    } else {
      setShowApprovals(false);
    }
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        // Explicit lineHeight > fontSize keeps descenders ("Pay", "Approvals")
        // from clipping on web, where the default label metrics are tighter.
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: "500" },
        ...headerOptions,
        // The broadcast-inbox bell (PR #11) lives in every header. Tabs
        // with their own stacks (Schedule, PTO) set it on their root
        // screens instead, since their tab header is hidden.
        headerRight: () => <InboxBell />,
      }}
    >
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
      {showApprovals && (
        <Tab.Screen
          name="Approvals"
          component={ManagerInboxScreen}
          options={{
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="checkmark-done-outline" size={size} color={color} />
            ),
          }}
        />
      )}
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

function RootNavigator() {
  const { session, loading, mustChangePassword, needsTosAcceptance, tenantId } =
    useAuth();

  // Restoring the persisted session on boot — hold on a spinner so we never
  // flash Login for an already-signed-in user.
  if (loading) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Gate order matters: password change first, then T&C, then Home. Each gate
  // clears its own user_metadata flag, which re-renders this navigator via the
  // USER_UPDATED auth event and advances to the next screen.
  return (
    <Stack.Navigator screenOptions={headerOptions}>
      {!session ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
          options={{ headerShown: false }}
        />
      ) : !tenantId ? (
        // Misprovisioned account (no user_metadata.tenant_id) — RLS returns
        // zero rows for it, so nothing downstream would work. Dead-ends here
        // with a sign-out; shouldn't happen once invites stamp the tenant.
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
      ) : (
        <Stack.Group>
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          {/* Broadcast inbox rides ABOVE the tabs, opened from the header
              bell. Plain card pushes (not native modals): a pushed card
              keeps its back button on every platform incl. web. */}
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
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <InboxProvider>
        <NavigationContainer>
          <RootNavigator />
          <ToastHost />
          <StatusBar style="auto" />
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
});
