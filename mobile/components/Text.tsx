import { forwardRef } from "react";
import {
  Text as RNText,
  TextInput as RNTextInput,
  StyleSheet,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from "react-native";
import { fontForWeight } from "../lib/theme";

// Brand-font drop-ins for react-native's Text/TextInput. Native custom fonts
// don't synthesize weights, so the style's fontWeight picks the matching
// Elms Sans family and the weight itself is stripped (avoids Android
// faux-bolding the already-bold file). An explicit fontFamily wins.
function brandStyle(style: StyleProp<TextStyle>): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  return {
    ...flat,
    fontFamily: flat.fontFamily ?? fontForWeight(flat.fontWeight),
    fontWeight: undefined,
  };
}

export const Text = forwardRef<React.ComponentRef<typeof RNText>, TextProps>(
  function Text({ style, ...props }, ref) {
    return <RNText ref={ref} {...props} style={brandStyle(style)} />;
  },
);

export const TextInput = forwardRef<
  React.ComponentRef<typeof RNTextInput>,
  TextInputProps
>(function TextInput({ style, ...props }, ref) {
  return <RNTextInput ref={ref} {...props} style={brandStyle(style)} />;
});
