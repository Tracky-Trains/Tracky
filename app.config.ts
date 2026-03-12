import "dotenv/config";
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Tracky",
  slug: "tracky",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/tracky-logo.png",
  scheme: "tracky",
  userInterfaceStyle: "automatic",
  platforms: ["ios", "android"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.tracky.app",
    infoPlist: {
      NSSupportsLiveActivities: true,
      ITSAppUsesNonExemptEncryption: false,
      NSLocationWhenInUseUsageDescription:
        "Tracky uses your location to show nearby stations and your position on the map.",
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "Tracky uses your location to show nearby stations and your position on the map.",
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType:
            "NSPrivacyAccessedAPICategoryDiskSpace",
          NSPrivacyAccessedAPITypeReasons: ["E174.1"],
        },
        {
          NSPrivacyAccessedAPIType:
            "NSPrivacyAccessedAPICategoryUserDefaults",
          NSPrivacyAccessedAPITypeReasons: ["CA92.1"],
        },
      ],
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#E6F4FE",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: "com.tracky.app",
    permissions: [
      "android.permission.READ_CALENDAR",
      "android.permission.WRITE_CALENDAR",
      "android.permission.POST_NOTIFICATIONS",
    ],
  },
  plugins: [
    [
      "react-native-maps",
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    ],
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/tracky-logo.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    [
      "expo-calendar",
      {
        calendarPermission:
          "Tracky needs calendar access to find past train trips and add them to your travel history.",
        calendarFullAccessPermission:
          "Tracky needs full calendar access to scan for past train trips.",
      },
    ],
    [
      "expo-notifications",
      {
        sounds: [],
      },
    ],
    ["expo-background-fetch"],
    "expo-font",
    "expo-web-browser",
    [
      "expo-widgets",
      {
        bundleIdentifier: "com.tracky.app.widgets",
        groupIdentifier: "group.com.tracky.app",
        widgets: [
          {
            name: "NextTrainWidget",
            displayName: "Next Train",
            description: "Shows your next upcoming train",
            supportedFamilies: [
              "systemSmall",
              "systemMedium",
              "accessoryInline",
              "accessoryRectangular",
              "accessoryCircular",
            ],
          },
        ],
        liveActivities: [
          {
            name: "TrainLiveActivity",
          },
        ],
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    eas: {
      projectId: "00c33d90-9f8b-406e-934e-bf66c9663310",
    },
  },
  owner: "jxu24",
};

export default { expo: config };
