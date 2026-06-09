#!/usr/bin/env python3
"""
Patches PiDash.xcodeproj/project.pbxproj to:
  1. Add PiDashWidget as a new WidgetKit extension target
     (sources: PiDashWidget.swift, PiDashWidgetBundle.swift,
      WidgetNetworking.swift, PiDashLiveActivity.swift,
      PiDashLiveActivityAttributes.swift)
  2. Add LiveActivity/ and Voice/ groups + source files to the PiDash target
     (LiveActivityManager.swift, PiDashLiveActivityAttributes.swift,
      VoiceManager.swift)
  3. Embed the widget extension in PiDash.app
  4. Add NSSupportsLiveActivities to PiDash/Info.plist
"""

import re, hashlib, shutil, pathlib, plistlib

PROJ  = pathlib.Path(__file__).parent / "PiDash.xcodeproj/project.pbxproj"
INFO  = pathlib.Path(__file__).parent / "PiDash/Info.plist"

# ── deterministic UUID from a stable seed ─────────────────────────────────────
def uid(seed: str) -> str:
    return hashlib.md5(seed.encode()).hexdigest()[:24].upper()

# ── IDs for every new object ──────────────────────────────────────────────────
# File references
R_LA_ATTRS   = uid("fileref.PiDashLiveActivityAttributes")
R_LA_MGR     = uid("fileref.LiveActivityManager")
R_VOICE_MGR  = uid("fileref.VoiceManager")
R_WGT_MAIN   = uid("fileref.PiDashWidget")
R_WGT_BUNDLE = uid("fileref.PiDashWidgetBundle")
R_WGT_NET    = uid("fileref.WidgetNetworking")
R_WGT_LA     = uid("fileref.PiDashLiveActivity")
R_WGT_INFO   = uid("fileref.PiDashWidget.Info.plist")
R_WGT_ENT    = uid("fileref.PiDashWidget.entitlements")
R_WGT_APPEX  = uid("fileref.PiDashWidget.appex")

# Build files — main app
B_LA_ATTRS_MAIN = uid("buildfile.main.PiDashLiveActivityAttributes")
B_LA_MGR_MAIN   = uid("buildfile.main.LiveActivityManager")
B_VOICE_MAIN    = uid("buildfile.main.VoiceManager")

# Build files — widget target
B_LA_ATTRS_WGT  = uid("buildfile.wgt.PiDashLiveActivityAttributes")
B_WGT_MAIN      = uid("buildfile.wgt.PiDashWidget")
B_WGT_BUNDLE    = uid("buildfile.wgt.PiDashWidgetBundle")
B_WGT_NET       = uid("buildfile.wgt.WidgetNetworking")
B_WGT_LA        = uid("buildfile.wgt.PiDashLiveActivity")
B_WGT_EMBED     = uid("buildfile.embed.PiDashWidget.appex")

# Groups
G_LIVEACT = uid("group.LiveActivity")
G_VOICE   = uid("group.Voice")
G_WIDGET  = uid("group.PiDashWidget")

# Widget target objects
TGT_WGT         = uid("target.PiDashWidget")
BP_WGT_SOURCES  = uid("buildphase.wgt.sources")
BP_WGT_RES      = uid("buildphase.wgt.resources")
BP_EMBED_WGT    = uid("buildphase.embed.widgets")
PROXY_WGT       = uid("proxy.PiDashWidget")
DEP_WGT         = uid("dep.PiDashWidget")
CFG_WGT_DEBUG   = uid("cfg.wgt.debug")
CFG_WGT_RELEASE = uid("cfg.wgt.release")
CFG_LIST_WGT    = uid("cfglist.wgt")

# ── load & back up the project ────────────────────────────────────────────────
src = PROJ.read_text()
shutil.copy(PROJ, str(PROJ) + ".bak")

# ── guard: don't run twice ────────────────────────────────────────────────────
if TGT_WGT in src:
    print("✅  Already patched — nothing to do.")
    raise SystemExit(0)

# ── helper: insert text BEFORE a marker ──────────────────────────────────────
def insert_before(text, marker, addition):
    idx = text.index(marker)
    return text[:idx] + addition + text[idx:]

def insert_after(text, marker, addition):
    idx = text.index(marker) + len(marker)
    return text[:idx] + addition + text[idx:]

# ══════════════════════════════════════════════════════════════════════════════
# 1. PBXFileReference entries
# ══════════════════════════════════════════════════════════════════════════════
FILE_REFS = f"""
		{R_LA_ATTRS}   /* PiDashLiveActivityAttributes.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PiDashLiveActivityAttributes.swift; sourceTree = "<group>"; }};
		{R_LA_MGR}     /* LiveActivityManager.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = LiveActivityManager.swift; sourceTree = "<group>"; }};
		{R_VOICE_MGR}  /* VoiceManager.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = VoiceManager.swift; sourceTree = "<group>"; }};
		{R_WGT_MAIN}   /* PiDashWidget.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PiDashWidget.swift; sourceTree = "<group>"; }};
		{R_WGT_BUNDLE} /* PiDashWidgetBundle.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PiDashWidgetBundle.swift; sourceTree = "<group>"; }};
		{R_WGT_NET}    /* WidgetNetworking.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = WidgetNetworking.swift; sourceTree = "<group>"; }};
		{R_WGT_LA}     /* PiDashLiveActivity.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = PiDashLiveActivity.swift; sourceTree = "<group>"; }};
		{R_WGT_INFO}   /* PiDashWidget/Info.plist */ = {{isa = PBXFileReference; lastKnownFileType = text.plist; path = Info.plist; sourceTree = "<group>"; }};
		{R_WGT_ENT}    /* PiDashWidget.entitlements */ = {{isa = PBXFileReference; lastKnownFileType = text.plist.entitlements; path = PiDashWidget.entitlements; sourceTree = "<group>"; }};
		{R_WGT_APPEX}  /* PiDashWidget.appex */ = {{isa = PBXFileReference; includeInIndex = 0; lastKnownFileType = "wrapper.app-extension"; path = PiDashWidget.appex; sourceTree = BUILT_PRODUCTS_DIR; }};
"""
src = insert_before(src, "/* End PBXFileReference section */", FILE_REFS)

# ══════════════════════════════════════════════════════════════════════════════
# 2. PBXBuildFile entries
# ══════════════════════════════════════════════════════════════════════════════
BUILD_FILES = f"""
		{B_LA_ATTRS_MAIN} /* PiDashLiveActivityAttributes.swift in Sources (PiDash) */ = {{isa = PBXBuildFile; fileRef = {R_LA_ATTRS} /* PiDashLiveActivityAttributes.swift */; }};
		{B_LA_MGR_MAIN}   /* LiveActivityManager.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {R_LA_MGR} /* LiveActivityManager.swift */; }};
		{B_VOICE_MAIN}    /* VoiceManager.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {R_VOICE_MGR} /* VoiceManager.swift */; }};
		{B_LA_ATTRS_WGT}  /* PiDashLiveActivityAttributes.swift in Sources (Widget) */ = {{isa = PBXBuildFile; fileRef = {R_LA_ATTRS} /* PiDashLiveActivityAttributes.swift */; }};
		{B_WGT_MAIN}      /* PiDashWidget.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {R_WGT_MAIN} /* PiDashWidget.swift */; }};
		{B_WGT_BUNDLE}    /* PiDashWidgetBundle.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {R_WGT_BUNDLE} /* PiDashWidgetBundle.swift */; }};
		{B_WGT_NET}       /* WidgetNetworking.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {R_WGT_NET} /* WidgetNetworking.swift */; }};
		{B_WGT_LA}        /* PiDashLiveActivity.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {R_WGT_LA} /* PiDashLiveActivity.swift */; }};
		{B_WGT_EMBED}     /* PiDashWidget.appex in Embed Widget Extensions */ = {{isa = PBXBuildFile; fileRef = {R_WGT_APPEX} /* PiDashWidget.appex */; settings = {{ATTRIBUTES = (RemoveHeadersOnCopy, ); }}; }};
"""
src = insert_before(src, "/* End PBXBuildFile section */", BUILD_FILES)

# ══════════════════════════════════════════════════════════════════════════════
# 3. PBXCopyFilesBuildPhase — Embed Widget Extensions
# ══════════════════════════════════════════════════════════════════════════════
EMBED_PHASE = f"""
		{BP_EMBED_WGT} /* Embed Widget Extensions */ = {{
			isa = PBXCopyFilesBuildPhase;
			buildActionMask = 2147483647;
			dstPath = "";
			dstSubfolderSpec = 13;
			files = (
				{B_WGT_EMBED} /* PiDashWidget.appex in Embed Widget Extensions */,
			);
			name = "Embed Widget Extensions";
			runOnlyForDeploymentPostprocessing = 0;
		}};
"""
src = insert_before(src, "/* End PBXCopyFilesBuildPhase section */", EMBED_PHASE)

# ══════════════════════════════════════════════════════════════════════════════
# 4. PBXGroup — LiveActivity, Voice, PiDashWidget
# ══════════════════════════════════════════════════════════════════════════════
GROUPS = f"""
		{G_LIVEACT} /* LiveActivity */ = {{
			isa = PBXGroup;
			children = (
				{R_LA_ATTRS} /* PiDashLiveActivityAttributes.swift */,
				{R_LA_MGR}   /* LiveActivityManager.swift */,
			);
			path = LiveActivity;
			sourceTree = "<group>";
		}};
		{G_VOICE} /* Voice */ = {{
			isa = PBXGroup;
			children = (
				{R_VOICE_MGR} /* VoiceManager.swift */,
			);
			path = Voice;
			sourceTree = "<group>";
		}};
		{G_WIDGET} /* PiDashWidget */ = {{
			isa = PBXGroup;
			children = (
				{R_WGT_INFO}   /* Info.plist */,
				{R_WGT_ENT}    /* PiDashWidget.entitlements */,
				{R_WGT_MAIN}   /* PiDashWidget.swift */,
				{R_WGT_BUNDLE} /* PiDashWidgetBundle.swift */,
				{R_WGT_NET}    /* WidgetNetworking.swift */,
				{R_WGT_LA}     /* PiDashLiveActivity.swift */,
			);
			path = PiDashWidget;
			sourceTree = "<group>";
		}};
"""
src = insert_before(src, "/* End PBXGroup section */", GROUPS)

# Add LiveActivity + Voice groups to the PiDash group children
PIDASH_GRP = '0FBD0B08711010CA9B546724'
src = src.replace(
    f'{PIDASH_GRP} /* PiDash */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t0EBD7361EF456B5F0436A74A /* Assets.xcassets */,',
    f'{PIDASH_GRP} /* PiDash */ = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t0EBD7361EF456B5F0436A74A /* Assets.xcassets */,\n\t\t\t\t{G_LIVEACT} /* LiveActivity */,\n\t\t\t\t{G_VOICE} /* Voice */,'
)

# Add PiDashWidget group to root group
ROOT_GRP = 'E3E2EF9DBC321DF234EC23C2'
src = src.replace(
    f'{ROOT_GRP} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t0FBD0B08711010CA9B546724 /* PiDash */,',
    f'{ROOT_GRP} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\t0FBD0B08711010CA9B546724 /* PiDash */,\n\t\t\t\t{G_WIDGET} /* PiDashWidget */,'
)

# Add appex to Products group
PROD_GRP = '8050E845E70EDEAD920DD7C3'
src = src.replace(
    f'{PROD_GRP} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\tBBFF5D72F491675D639A0E31 /* PiDash.app */,',
    f'{PROD_GRP} = {{\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (\n\t\t\t\tBBFF5D72F491675D639A0E31 /* PiDash.app */,\n\t\t\t\t{R_WGT_APPEX} /* PiDashWidget.appex */,'
)

# ══════════════════════════════════════════════════════════════════════════════
# 5. PBXNativeTarget — PiDashWidget
# ══════════════════════════════════════════════════════════════════════════════
WIDGET_TARGET = f"""
		{TGT_WGT} /* PiDashWidget */ = {{
			isa = PBXNativeTarget;
			buildConfigurationList = {CFG_LIST_WGT} /* Build configuration list for PBXNativeTarget "PiDashWidget" */;
			buildPhases = (
				{BP_WGT_SOURCES} /* Sources */,
				{BP_WGT_RES}     /* Resources */,
			);
			buildRules = (
			);
			dependencies = (
			);
			name = PiDashWidget;
			packageProductDependencies = (
			);
			productName = PiDashWidget;
			productReference = {R_WGT_APPEX} /* PiDashWidget.appex */;
			productType = "com.apple.product-type.app-extension";
		}};
"""
src = insert_before(src, "/* End PBXNativeTarget section */", WIDGET_TARGET)

# ══════════════════════════════════════════════════════════════════════════════
# 6. Container proxy + target dependency (PiDash depends on PiDashWidget)
# ══════════════════════════════════════════════════════════════════════════════
PROXY = f"""
		{PROXY_WGT} /* PBXContainerItemProxy */ = {{
			isa = PBXContainerItemProxy;
			containerPortal = 8F3C83F3BACDF2B76FCEDC61 /* Project object */;
			proxyType = 1;
			remoteGlobalIDString = {TGT_WGT};
			remoteInfo = PiDashWidget;
		}};
"""
src = insert_before(src, "/* End PBXContainerItemProxy section */", PROXY)

DEP = f"""
		{DEP_WGT} /* PBXTargetDependency */ = {{
			isa = PBXTargetDependency;
			target = {TGT_WGT} /* PiDashWidget */;
			targetProxy = {PROXY_WGT} /* PBXContainerItemProxy */;
		}};
"""
src = insert_before(src, "/* End PBXTargetDependency section */", DEP)

# ══════════════════════════════════════════════════════════════════════════════
# 7. PBXSourcesBuildPhase + PBXResourcesBuildPhase for widget
# ══════════════════════════════════════════════════════════════════════════════
WGT_PHASES = f"""
		{BP_WGT_SOURCES} /* Sources (PiDashWidget) */ = {{
			isa = PBXSourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
				{B_LA_ATTRS_WGT} /* PiDashLiveActivityAttributes.swift in Sources */,
				{B_WGT_MAIN}     /* PiDashWidget.swift in Sources */,
				{B_WGT_BUNDLE}   /* PiDashWidgetBundle.swift in Sources */,
				{B_WGT_NET}      /* WidgetNetworking.swift in Sources */,
				{B_WGT_LA}       /* PiDashLiveActivity.swift in Sources */,
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
		{BP_WGT_RES} /* Resources (PiDashWidget) */ = {{
			isa = PBXResourcesBuildPhase;
			buildActionMask = 2147483647;
			files = (
			);
			runOnlyForDeploymentPostprocessing = 0;
		}};
"""
src = insert_before(src, "/* End PBXSourcesBuildPhase section */", WGT_PHASES)

# ══════════════════════════════════════════════════════════════════════════════
# 8. XCBuildConfiguration for PiDashWidget (Debug + Release)
# ══════════════════════════════════════════════════════════════════════════════
WGT_CFGS = f"""
		{CFG_WGT_DEBUG} /* Debug (PiDashWidget) */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = PiDashWidget/PiDashWidget.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = ZBL5RZ37FG;
				INFOPLIST_FILE = PiDashWidget/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = "com.sam.pidash.widget";
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_VERSION = 5.9;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Debug;
		}};
		{CFG_WGT_RELEASE} /* Release (PiDashWidget) */ = {{
			isa = XCBuildConfiguration;
			buildSettings = {{
				CODE_SIGN_ENTITLEMENTS = PiDashWidget/PiDashWidget.entitlements;
				CODE_SIGN_STYLE = Automatic;
				CURRENT_PROJECT_VERSION = 1;
				DEVELOPMENT_TEAM = ZBL5RZ37FG;
				INFOPLIST_FILE = PiDashWidget/Info.plist;
				IPHONEOS_DEPLOYMENT_TARGET = 17.0;
				LD_RUNPATH_SEARCH_PATHS = (
					"$(inherited)",
					"@executable_path/Frameworks",
					"@executable_path/../../Frameworks",
				);
				MARKETING_VERSION = 1.0;
				PRODUCT_BUNDLE_IDENTIFIER = "com.sam.pidash.widget";
				PRODUCT_NAME = "$(TARGET_NAME)";
				SDKROOT = iphoneos;
				SWIFT_COMPILATION_MODE = wholemodule;
				SWIFT_OPTIMIZATION_LEVEL = "-O";
				SWIFT_VERSION = 5.9;
				TARGETED_DEVICE_FAMILY = "1,2";
			}};
			name = Release;
		}};
"""
src = insert_before(src, "/* End XCBuildConfiguration section */", WGT_CFGS)

# ══════════════════════════════════════════════════════════════════════════════
# 9. XCConfigurationList for PiDashWidget
# ══════════════════════════════════════════════════════════════════════════════
CFG_LIST = f"""
		{CFG_LIST_WGT} /* Build configuration list for PBXNativeTarget "PiDashWidget" */ = {{
			isa = XCConfigurationList;
			buildConfigurations = (
				{CFG_WGT_DEBUG}   /* Debug */,
				{CFG_WGT_RELEASE} /* Release */,
			);
			defaultConfigurationIsVisible = 0;
			defaultConfigurationName = Debug;
		}};
"""
src = insert_before(src, "/* End XCConfigurationList section */", CFG_LIST)

# ══════════════════════════════════════════════════════════════════════════════
# 10. Update existing PiDash target: add embed phase + dependency
# ══════════════════════════════════════════════════════════════════════════════
PIDASH_TGT = '777CC3B5B79BBAA6C06F1A7A'

# Add embed widget phase to buildPhases
src = src.replace(
    '\t\t\t\t0CDCD6DC30BB4EBC7C3A931D /* Embed Foundation Extensions */,\n\t\t\t);',
    f'\t\t\t\t0CDCD6DC30BB4EBC7C3A931D /* Embed Foundation Extensions */,\n\t\t\t\t{BP_EMBED_WGT} /* Embed Widget Extensions */,\n\t\t\t);',
    1
)

# Add widget target dependency
src = src.replace(
    '\t\t\tdependencies = (\n\t\t\t\t1A0921AD09C4D2E59B69BE46 /* PBXTargetDependency */,\n\t\t\t);',
    f'\t\t\tdependencies = (\n\t\t\t\t1A0921AD09C4D2E59B69BE46 /* PBXTargetDependency */,\n\t\t\t\t{DEP_WGT} /* PBXTargetDependency */,\n\t\t\t);',
    1
)

# ══════════════════════════════════════════════════════════════════════════════
# 11. Add new files to PiDash Sources build phase
# ══════════════════════════════════════════════════════════════════════════════
src = src.replace(
    '\t\t\t\tE905F289C9955FF64CC5EF8A /* WebView.swift in Sources */,\n\t\t\t);',
    f'\t\t\t\tE905F289C9955FF64CC5EF8A /* WebView.swift in Sources */,\n\t\t\t\t{B_LA_ATTRS_MAIN} /* PiDashLiveActivityAttributes.swift in Sources */,\n\t\t\t\t{B_LA_MGR_MAIN} /* LiveActivityManager.swift in Sources */,\n\t\t\t\t{B_VOICE_MAIN} /* VoiceManager.swift in Sources */,\n\t\t\t);\n',
    1
)

# Fix double newline if any
src = src.replace('\n\n\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;', '\n\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;')

# ══════════════════════════════════════════════════════════════════════════════
# 12. Add PiDashWidget to project targets + TargetAttributes
# ══════════════════════════════════════════════════════════════════════════════
src = src.replace(
    '\t\t\ttargets = (\n\t\t\t\t777CC3B5B79BBAA6C06F1A7A /* PiDash */,\n\t\t\t\t9DDB30A3D50949B2F5E6B39C /* PiDashShare */,',
    f'\t\t\ttargets = (\n\t\t\t\t777CC3B5B79BBAA6C06F1A7A /* PiDash */,\n\t\t\t\t9DDB30A3D50949B2F5E6B39C /* PiDashShare */,\n\t\t\t\t{TGT_WGT} /* PiDashWidget */,',
    1
)

src = src.replace(
    '\t\t\t\t\t9DDB30A3D50949B2F5E6B39C = {\n\t\t\t\t\t\tDevelopmentTeam = ZBL5RZ37FG;\n\t\t\t\t\t\tProvisioningStyle = Automatic;\n\t\t\t\t\t};',
    f'\t\t\t\t\t9DDB30A3D50949B2F5E6B39C = {{\n\t\t\t\t\t\tDevelopmentTeam = ZBL5RZ37FG;\n\t\t\t\t\t\tProvisioningStyle = Automatic;\n\t\t\t\t\t}};\n\t\t\t\t\t{TGT_WGT} = {{\n\t\t\t\t\t\tDevelopmentTeam = ZBL5RZ37FG;\n\t\t\t\t\t\tProvisioningStyle = Automatic;\n\t\t\t\t\t}};',
    1
)

# ══════════════════════════════════════════════════════════════════════════════
# Write patched project
# ══════════════════════════════════════════════════════════════════════════════
PROJ.write_text(src)
print(f"✅  project.pbxproj patched ({PROJ.stat().st_size} bytes).")

# ══════════════════════════════════════════════════════════════════════════════
# 13. Patch Info.plist: add NSSupportsLiveActivities
# ══════════════════════════════════════════════════════════════════════════════
with open(INFO, "rb") as f:
    info = plistlib.load(f)

if "NSSupportsLiveActivities" not in info:
    info["NSSupportsLiveActivities"] = True
    info["NSSupportsLiveActivitiesFrequentUpdates"] = True
    with open(INFO, "wb") as f:
        plistlib.dump(info, f, fmt=plistlib.FMT_XML, sort_keys=False)
    print("✅  Info.plist: NSSupportsLiveActivities = YES")
else:
    print("ℹ️   Info.plist: NSSupportsLiveActivities already set.")

print("\nDone. Open Xcode and build the PiDash scheme.")
