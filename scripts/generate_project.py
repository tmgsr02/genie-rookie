#!/usr/bin/env python3
"""Generate the Xcode project without an external project generator."""

import argparse
import hashlib
import ipaddress
import json
import plistlib
import re
from pathlib import Path
from urllib.parse import urlsplit

from build_native import IOS_DEPLOYMENT_TARGET

ROOT = Path(__file__).resolve().parents[1]
objects = {}


def obj(object_key, **fields):
    ident = hashlib.sha256(object_key.encode()).hexdigest()[:24].upper()
    objects[ident] = fields
    return ident


def render(value, depth=0):
    indent = "\t" * depth
    if isinstance(value, dict):
        return (
            "{\n"
            + "".join(
                indent + "\t" + json.dumps(k) + " = " + render(v, depth + 1) + ";\n"
                for k, v in value.items()
            )
            + indent
            + "}"
        )
    if isinstance(value, list):
        return "(" + ", ".join(render(v, depth) for v in value) + ")"
    return json.dumps(value)


def service_plist_entries(config, require_hosted=False):
    """Bundle public addresses only; credentials and local overrides stay elsewhere."""
    services = config.get("services", {})
    keys = {"tutor_url": "TutorServiceURL", "boson_proxy_url": "BosonProxyURL"}
    if not isinstance(services, dict) or set(services) - (keys.keys() | {"managed_access"}):
        raise ValueError("services accepts only tutor_url, boson_proxy_url and managed_access; never credentials")
    managed = services.get("managed_access", False)
    if not isinstance(managed, bool):
        raise ValueError("services.managed_access must be a boolean")
    entries = {"ManagedServiceAccess": managed}
    for name, plist_key in keys.items():
        value = services.get(name, "")
        if not isinstance(value, str):
            raise ValueError(f"services.{name} must be a public HTTPS address")
        value = value.strip()
        if not value:
            continue
        try:
            parsed = urlsplit(value)
            host = (parsed.hostname or "").lower().rstrip(".")
            # Accessing port also validates malformed/non-numeric port strings.
            parsed.port
            if (parsed.scheme != "https" or not host or parsed.username is not None
                    or parsed.password is not None or parsed.query or parsed.fragment
                    or any(char.isspace() for char in value) or "%" in host
                    or host == "localhost" or host.endswith((".localhost", ".local"))):
                raise ValueError()
            try:
                public = ipaddress.ip_address(host).is_global
            except ValueError:
                public = "." in host and not re.fullmatch(r"[\d.]+", host)
            if not public:
                raise ValueError()
        except ValueError:
            # Do not echo a mistakenly supplied credential in build logs.
            raise ValueError(f"services.{name} must be a public HTTPS address without credentials, query or fragment") from None
        entries[plist_key] = value
    if require_hosted or managed:
        missing = [name for name, key in keys.items() if key not in entries]
        if missing:
            raise ValueError("Hosted endpoint configuration missing: " + ", ".join(missing))
    if require_hosted and not managed:
        raise ValueError("Judge builds require services.managed_access=true for automatic app access")
    return entries


def main(app="GeniusRookie", require_hosted_services=False):
    objects.clear()
    if app not in {"GeniusRookie"}:
        raise ValueError("Unknown application")
    app_root = ROOT if app == "PipecatVoice" else ROOT / "apps" / app
    config = (
        json.loads((app_root / "app.json").read_text())
        if app != "PipecatVoice"
        else {
            "display_name": "Little Voices",
            "bundle_id": "ai.pipecat.littlevoices",
            "version": "1.0",
            "build": "1",
        }
    )
    if require_hosted_services and app != "GeniusRookie":
        raise ValueError("--require-hosted-services applies only to GeniusRookie")
    services = service_plist_entries(config, require_hosted_services) if app == "GeniusRookie" else {}
    source_path = (app_root / "src/ios/PipecatVoice").relative_to(ROOT).as_posix()
    existing = ROOT / f"{app}.xcodeproj/project.pbxproj"
    signing_team = None
    if existing.exists():
        match = re.search(r'"?DEVELOPMENT_TEAM"?\s*=\s*"?([A-Z0-9]+)"?\s*;', existing.read_text())
        if match:
            signing_team = match.group(1)
    files, compiled, bundled = [], [], []
    for path in sorted((ROOT / source_path).iterdir()):
        if path.name == "LessonScene" and path.is_dir():
            ref = obj(
                path.name,
                isa="PBXFileReference",
                lastKnownFileType="folder",
                path=path.name,
                sourceTree="<group>",
            )
            files.append(ref)
            bundled.append(obj(path.name + "-build", isa="PBXBuildFile", fileRef=ref))
            continue
        if path.suffix not in {".swift", ".m", ".h", ".xcassets", ".xcprivacy"}:
            continue
        kind = {
            ".swift": "sourcecode.swift",
            ".m": "sourcecode.c.objc",
            ".h": "sourcecode.c.h",
            ".xcassets": "folder.assetcatalog",
            ".xcprivacy": "text.xml",
        }[path.suffix]
        ref = obj(
            path.name,
            isa="PBXFileReference",
            lastKnownFileType=kind,
            path=path.name,
            sourceTree="<group>",
        )
        files.append(ref)
        if path.suffix in {".xcassets", ".xcprivacy"}:
            bundled.append(obj(path.name + "-build", isa="PBXBuildFile", fileRef=ref))
        elif path.suffix != ".h":
            compiled.append(obj(path.name + "-build", isa="PBXBuildFile", fileRef=ref))
    source_group = obj(
        "sources", isa="PBXGroup", children=files, path=source_path, sourceTree="<group>"
    )
    python = obj(
        "python",
        isa="PBXFileReference",
        lastKnownFileType="wrapper.xcframework",
        path="Vendor/Python.xcframework",
        sourceTree="<group>",
    )
    python_link = obj("python-link", isa="PBXBuildFile", fileRef=python)
    python_embed = obj(
        "python-embed",
        isa="PBXBuildFile",
        fileRef=python,
        settings={"ATTRIBUTES": ["CodeSignOnCopy", "RemoveHeadersOnCopy"]},
    )
    product = obj(
        "product",
        isa="PBXFileReference",
        explicitFileType="wrapper.application",
        path=f"{app}.app",
        sourceTree="BUILT_PRODUCTS_DIR",
    )
    products = obj(
        "products", isa="PBXGroup", children=[product], name="Products", sourceTree="<group>"
    )
    group = obj(
        "root-group",
        isa="PBXGroup",
        children=[source_group, python, products],
        sourceTree="<group>",
    )
    sources = obj(
        "sources-phase",
        isa="PBXSourcesBuildPhase",
        buildActionMask=2147483647,
        files=compiled,
        runOnlyForDeploymentPostprocessing=0,
    )
    frameworks = obj(
        "framework-phase",
        isa="PBXFrameworksBuildPhase",
        buildActionMask=2147483647,
        files=[python_link],
        runOnlyForDeploymentPostprocessing=0,
    )
    resources = obj(
        "resources-phase",
        isa="PBXResourcesBuildPhase",
        buildActionMask=2147483647,
        files=bundled,
        runOnlyForDeploymentPostprocessing=0,
    )
    bundle = obj(
        "bundle-phase",
        isa="PBXShellScriptBuildPhase",
        buildActionMask=2147483647,
        files=[],
        inputPaths=[],
        outputPaths=[
            "$(TARGET_BUILD_DIR)/$(UNLOCALIZED_RESOURCES_FOLDER_PATH)/PythonRuntime.stamp"
        ],
        name="Bundle Python, Phonon and Audience",
        shellPath="/bin/sh",
        shellScript=(
            'set -eu\n'
            'if [ -f "$SRCROOT/.build/judge-pipecat-modules.json" ]; then\n'
            '  /usr/bin/python3 "$SRCROOT/scripts/bundle_runtime.py"\n'
            'else\n'
            '  "$SRCROOT/.venv/bin/python" "$SRCROOT/scripts/bundle_runtime.py"\n'
            'fi\n'
            if app == "GeniusRookie" else
            'set -eu\n"$SRCROOT/.venv/bin/python" "$SRCROOT/scripts/bundle_runtime.py"\n'
        ),
        alwaysOutOfDate=1,
        runOnlyForDeploymentPostprocessing=0,
    )
    embed = obj(
        "embed-phase",
        isa="PBXCopyFilesBuildPhase",
        buildActionMask=2147483647,
        dstPath="",
        dstSubfolderSpec=10,
        files=[python_embed],
        name="Embed Frameworks",
        runOnlyForDeploymentPostprocessing=0,
    )
    common = {
        "ARCHS": "arm64",
        "SDKROOT": "iphoneos",
        "IPHONEOS_DEPLOYMENT_TARGET": IOS_DEPLOYMENT_TARGET,
        "SWIFT_VERSION": "5.0",
        "CLANG_ENABLE_MODULES": "YES",
        "CLANG_ENABLE_OBJC_ARC": "YES",
        "ENABLE_USER_SCRIPT_SANDBOXING": "NO",
        "SWIFT_STRICT_CONCURRENCY": "targeted",
        # Accelerate's current LAPACK interface (lip-sync root finding uses dgeev).
        "OTHER_SWIFT_FLAGS": ["$(inherited)", "-Xcc", "-DACCELERATE_NEW_LAPACK"],
    }
    target_settings = {
        "PRODUCT_BUNDLE_IDENTIFIER": config["bundle_id"],
        "PRODUCT_NAME": "$(TARGET_NAME)",
        "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon",
        "TARGETED_DEVICE_FAMILY": "1,2",
        "SUPPORTED_PLATFORMS": "iphoneos iphonesimulator",
        "SUPPORTS_MACCATALYST": "NO",
        # Not offered on Macs or Vision Pro, where the audio session and Apple Intelligence path
        # are untested.
        "SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD": "NO",
        "SUPPORTS_XR_DESIGNED_FOR_IPHONE_IPAD": "NO",
        "CODE_SIGN_STYLE": "Automatic",
        "INFOPLIST_FILE": f"{source_path}/Info.plist",
        "GENERATE_INFOPLIST_FILE": "NO",
        "SWIFT_OBJC_BRIDGING_HEADER": f"{source_path}/PipecatVoice-Bridging-Header.h",
        "HEADER_SEARCH_PATHS": ["$(inherited)", "$(SRCROOT)/native/phonon-ffi/include"],
        "LIBRARY_SEARCH_PATHS[sdk=iphoneos*]": [
            "$(inherited)",
            "$(SRCROOT)/.build/rust/aarch64-apple-ios/release",
        ],
        "LIBRARY_SEARCH_PATHS[sdk=iphonesimulator*]": [
            "$(inherited)",
            "$(SRCROOT)/.build/rust/aarch64-apple-ios-sim/release",
        ],
        "LD_RUNPATH_SEARCH_PATHS": ["$(inherited)", "@executable_path/Frameworks"],
        "OTHER_LDFLAGS": [
            "$(inherited)",
            "-lphonon_ffi",
            "-framework",
            "NaturalLanguage",
            "-framework",
            "SoundAnalysis",
        ],
        "CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER": "NO",
        "MARKETING_VERSION": config["version"],
        "CURRENT_PROJECT_VERSION": config["build"],
    }
    if app != "PipecatVoice":
        target_settings["LITTLE_VOICES_APP"] = app
    if signing_team:
        target_settings["DEVELOPMENT_TEAM"] = signing_team

    def configurations(prefix, base):
        values = []
        for name in ["Debug", "Release"]:
            settings = dict(base)
            if name == "Debug":
                settings["SWIFT_ACTIVE_COMPILATION_CONDITIONS"] = [
                    *settings.get("SWIFT_ACTIVE_COMPILATION_CONDITIONS", ["$(inherited)"]),
                    "DEBUG",
                ]
                settings["GCC_PREPROCESSOR_DEFINITIONS"] = ["$(inherited)", "DEBUG=1"]
            settings.update(
                {
                    "SWIFT_OPTIMIZATION_LEVEL": "-Onone" if name == "Debug" else "-O",
                    "GCC_OPTIMIZATION_LEVEL": "0" if name == "Debug" else "s",
                    "DEBUG_INFORMATION_FORMAT": "dwarf" if name == "Debug" else "dwarf-with-dsym",
                    # Whole-module Release builds inline across files in the real-time code.
                    "SWIFT_COMPILATION_MODE": "singlefile" if name == "Debug" else "wholemodule",
                    "VALIDATE_PRODUCT": "NO" if name == "Debug" else "YES",
                }
            )
            values.append(
                obj(
                    prefix + name,
                    isa="XCBuildConfiguration",
                    name=name,
                    buildSettings=settings,
                )
            )
        return obj(
            prefix + "configs",
            isa="XCConfigurationList",
            buildConfigurations=values,
            defaultConfigurationIsVisible=0,
            defaultConfigurationName="Release",
        )

    target = obj(
        "target",
        isa="PBXNativeTarget",
        name=app,
        productName=app,
        productType="com.apple.product-type.application",
        productReference=product,
        buildConfigurationList=configurations("target", target_settings),
        buildPhases=[sources, frameworks, resources, bundle, embed],
        buildRules=[],
        dependencies=[],
    )
    project = obj(
        "project",
        isa="PBXProject",
        buildConfigurationList=configurations("project", common),
        compatibilityVersion="Xcode 14.0",
        developmentRegion="en",
        hasScannedForEncodings=0,
        knownRegions=["en", "Base"],
        mainGroup=group,
        productRefGroup=products,
        projectDirPath="",
        projectRoot="",
        targets=[target],
        attributes={"LastUpgradeCheck": "2700", "BuildIndependentTargetsInParallel": "YES"},
    )
    folder = ROOT / f"{app}.xcodeproj"
    folder.mkdir(exist_ok=True)
    document = {
        "archiveVersion": 1,
        "classes": {},
        "objectVersion": 56,
        "objects": objects,
        "rootObject": project,
    }
    (folder / "project.pbxproj").write_text("// !$*UTF8*$!\n" + render(document) + "\n")
    schemes = folder / "xcshareddata/xcschemes"
    schemes.mkdir(parents=True, exist_ok=True)
    reference = f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{target}" BuildableName="{app}.app" BlueprintName="{app}" ReferencedContainer="container:{app}.xcodeproj"/>'
    (schemes / f"{app}.xcscheme").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2700" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
    <BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{reference}</BuildActionEntry>
  </BuildActionEntries></BuildAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{reference}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
""")
    info = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleDisplayName": config["display_name"],
        "CFBundleExecutable": "$(EXECUTABLE_NAME)",
        "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": config["display_name"],
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "$(MARKETING_VERSION)",
        "CFBundleVersion": "$(CURRENT_PROJECT_VERSION)",
        "LSRequiresIPhoneOS": True,
        "NSMicrophoneUsageDescription": "Little Voices listens to your questions so the angel and the devil can answer. Your voice never leaves your device.",
        "NSSpeechRecognitionUsageDescription": "Little Voices transcribes your voice with Apple’s on-device speech recognition.",
        # The splash art, centred and unscaled: each idiom's image covers its largest screen.
        "UILaunchScreen": {
            "UIColorName": "LaunchBackground",
            "UIImageName": "LaunchSplash",
            "UIImageRespectsSafeAreaInsets": False,
        },
        # Lets the stage animate at 120 Hz on ProMotion iPhones.
        "CADisableMinimumFrameDurationOnPhone": True,
        "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
        "UISupportedInterfaceOrientations~ipad": [
            "UIInterfaceOrientationPortrait",
            "UIInterfaceOrientationPortraitUpsideDown",
            "UIInterfaceOrientationLandscapeLeft",
            "UIInterfaceOrientationLandscapeRight",
        ],
        # Always light, so Settings and system UI match the stage's palette.
        "UIUserInterfaceStyle": "Light",
        # No encryption beyond hashing (Python's hashlib modules) and the system's own, so
        # uploads need no export compliance documents.
        "ITSAppUsesNonExemptEncryption": False,
    }
    if app != "PipecatVoice":
        info["NSMicrophoneUsageDescription"] = (
            f"{config['display_name']} listens while you hold the microphone. "
            "Recognition stays on this device. Boson sends character dialogue online for speech; "
            "Phonon synthesizes it on device."
        )
        info["NSSpeechRecognitionUsageDescription"] = (
            f"{config['display_name']} transcribes questions using Apple's on-device speech recognition."
        )
        # Product launch art is separate from the upstream illustration.
        info["UILaunchScreen"] = {"UIColorName": "BrandLaunchBackground"}
    if app == "GeniusRookie":
        info.update(services)
        info["NSAppTransportSecurity"] = {"NSAllowsLocalNetworking": True}
        info["NSLocalNetworkUsageDescription"] = "Connect to a grown-up configured tutor service on your local network."
        info["NSMicrophoneUsageDescription"] = "Genie & Rookie transcribes speech on this device. Questions are sent to your configured tutor service to plan explanations. Boson sends character dialogue online for speech; Phonon speaks on device."
    (ROOT / source_path / "Info.plist").write_bytes(plistlib.dumps(info))
    print(f"Generated {app}.xcodeproj")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--app", choices=["GeniusRookie"], default="GeniusRookie"
    )
    parser.add_argument(
        "--all", action="store_true", help="Regenerate the Genie & Rookie app"
    )
    parser.add_argument(
        "--require-hosted-services", action="store_true",
        help="Require both public GeniusRookie service URLs and managed_access=true; does not verify deployed service health",
    )
    args = parser.parse_args()
    if args.require_hosted_services and (args.all or args.app != "GeniusRookie"):
        parser.error("--require-hosted-services requires --app GeniusRookie without --all")
    for app in ["GeniusRookie"] if args.all else [args.app]:
        try:
            main(app, require_hosted_services=args.require_hosted_services)
        except ValueError as error:
            parser.error(str(error))
