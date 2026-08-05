import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import TosAcceptanceModal from "./components/TosAcceptanceModal";
import { colors } from "./lib/theme";
import ChangePasswordScreen from "./screens/ChangePasswordScreen";
import HomeScreen from "./screens/HomeScreen";
import LoginScreen from "./screens/LoginScreen";

export type RootStackParamList = {
  Login: undefined;
  ChangePassword: undefined;
  TosAcceptance: undefined;
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function RootNavigator() {
  const { session, loading, mustChangePassword, needsTosAcceptance } =
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
    <Stack.Navigator>
      {!session ? (
        <Stack.Screen
          name="Login"
          component={LoginScreen}
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
        <Stack.Screen
          name="Home"
          component={HomeScreen}
          options={{ title: "manadele" }}
        />
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <RootNavigator />
        <StatusBar style="auto" />
      </NavigationContainer>
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
