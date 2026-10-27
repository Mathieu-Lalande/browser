import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BrowserScreen } from "./components/BrowserScreen";
import { BrowserProvider, useBrowserState } from "./state/BrowserProvider";
import { ThemeProvider, useTheme } from "./state/theme";

function Root() {
  const { ready } = useBrowserState();
  const { colors } = useTheme();
  // Stored tabs/settings load in a few ms; showing nothing avoids a flash of the wrong theme.
  if (!ready) return <View style={[styles.root, { backgroundColor: colors.bg }]} />;
  return <BrowserScreen />;
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <BrowserProvider>
            <ThemeProvider>
              <Root />
            </ThemeProvider>
          </BrowserProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
