export type TabOrientation = "horizontal" | "vertical";

const settings = $state<{ tabOrientation: TabOrientation }>({ tabOrientation: "horizontal" });

export const ui = {
  get tabOrientation(): TabOrientation {
    return settings.tabOrientation;
  },
  toggleTabOrientation(): void {
    settings.tabOrientation = settings.tabOrientation === "horizontal" ? "vertical" : "horizontal";
  },
};
