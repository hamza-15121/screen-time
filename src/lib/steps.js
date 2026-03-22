const SHARED_STEPS = [
  {
    id: "find_my_toggle",
    title: "Turn OFF Find My Device",
    risk: "Leaving Find My ON can allow bypass routes. Turn it OFF before continuing for stronger lock resistance.",
    instructions: {
      ios: "Settings > [Your Name] > Find My > Find My iPhone. Turn OFF Find My Device. For location sharing replacement, use Life360 from the Apple App Store.",
      ipados: "Settings > [Your Name] > Find My > Find My iPad. Turn OFF Find My Device. For location sharing replacement, use Life360 from the Apple App Store.",
      macos: "System Settings > [Your Name] > iCloud > Find My Mac. Turn OFF Find My Device."
    }
  },
  {
    id: "sign_out_icloud",
    title: "Log Out of iCloud (Apple Account) on This Device",
    risk: "You must complete sign-out before continuing. Make sure you know your credentials before logging out.",
    instructions: {
      ios: "Settings > [Your Name] > Sign Out. Log out of iCloud/Apple Account on this device, then continue with Screen Time setup.",
      ipados: "Settings > [Your Name] > Sign Out. Log out of iCloud/Apple Account on this device, then continue with Screen Time setup.",
      macos: "System Settings > [Your Name] > Sign Out. Log out of iCloud/Apple Account on this device, then continue with Screen Time setup."
    }
  },
  {
    id: "set_easy_temp_pin",
    title: "Set easy temporary Screen Time passcode",
    risk: "This temporary code is only a setup bridge. You still accept lockout responsibility.",
    instructions: {
      ios: "Settings > Screen Time > Use Screen Time Passcode. Set an easy temporary code like 1111.",
      ipados: "Settings > Screen Time > Use Screen Time Passcode. Set an easy temporary code like 1111.",
      macos: "System Settings > Screen Time > Lock Screen Time Settings. Set an easy temporary code like 1111."
    }
  },
  {
    id: "app_limits_zero",
    title: "Configure and Set App Limits",
    risk: "Incorrect category choices can block apps you still need.",
    instructions: {
      ios: "Screen Time > App Limits > Add Limit. Set targeted categories/apps to the minimum possible time and enable Block at End of Limit.",
      ipados: "Screen Time > App Limits > Add Limit. Set targeted categories/apps to the minimum possible time and enable Block at End of Limit.",
      macos: "Screen Time > App Limits > Add Limit. Set targeted categories/apps to the minimum possible time and enable Block at End of Limit."
    }
  },
  {
    id: "web_allowed_only",
    title: "Configure Allowed Websites and Content Blocking",
    risk: "This can block many websites, including some useful pages.",
    instructions: {
      ios: "Screen Time > Content & Privacy Restrictions > Content Restrictions > Web Content > Allowed Websites Only.",
      ipados: "Screen Time > Content & Privacy Restrictions > Content Restrictions > Web Content > Allowed Websites Only.",
      macos: "Screen Time > Content & Privacy > Web Content > Allowed Websites Only."
    }
  },
  {
    id: "disable_store_changes",
    title: "Disable installs and in-app purchases",
    risk: "You may not be able to install needed apps until unlock.",
    instructions: {
      ios: "Content & Privacy Restrictions > iTunes & App Store Purchases > set Installing Apps and In-App Purchases to Don't Allow.",
      ipados: "Content & Privacy Restrictions > iTunes & App Store Purchases > set Installing Apps and In-App Purchases to Don't Allow.",
      macos: "Content & Privacy Restrictions > App Store and media changes > Don't Allow."
    }
  },
  {
    id: "disable_account_changes",
    title: "Disable Accounts",
    risk: "Recovery/account updates may be blocked during lock.",
    instructions: {
      ios: "Content & Privacy Restrictions > Accounts > Don't Allow.",
      ipados: "Content & Privacy Restrictions > Accounts > Don't Allow.",
      macos: "Content & Privacy Restrictions > Accounts > Don't Allow."
    }
  },
  {
    id: "open_change_passcode",
    title: "Go Back and Click Change Screen Time Passcode",
    risk: "The next sequence sets a code you should not try to memorize.",
    instructions: {
      ios: "Screen Time > Change Screen Time Passcode. Stay on the passcode entry screen.",
      ipados: "Screen Time > Change Screen Time Passcode. Stay on the passcode entry screen.",
      macos: "Screen Time > Change Passcode. Stay on the passcode entry screen."
    }
  },
  {
    id: "recovery_notice",
    title: "Terms and Conditions + Liability Acknowledgment",
    risk: "By proceeding, you confirm you understand and accept all terms, lockout risks, and account-recovery responsibility.",
    instructions: {
      ios: "Read and accept the terms below before passcode sequence generation.",
      ipados: "Read and accept the terms below before passcode sequence generation.",
      macos: "Read and accept the terms below before passcode sequence generation."
    }
  }
];

const STEPS_BY_TRACK = {
  study_focus: SHARED_STEPS,
  control_screentime: SHARED_STEPS,
  adult_content_block: SHARED_STEPS
};

const TRACK_ORDER = ["study_focus", "control_screentime", "adult_content_block"];
const PLATFORM_ORDER = ["ios", "ipados", "macos"];

module.exports = { STEPS_BY_TRACK, TRACK_ORDER, PLATFORM_ORDER };
