import { appAnalysisCoordinator, appSessionStore } from "./session/index";

App({
  onShow() {
    void appSessionStore.expireIfNeeded();
  },

  onHide() {
    appAnalysisCoordinator.cancel("hidden");
  },
});

