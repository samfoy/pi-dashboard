# Add project specific ProGuard rules here.
# WebView JavaScript interface: keep bridge class
-keep class com.sam.pidash.PiBridge { *; }
-keepclassmembers class com.sam.pidash.PiBridge {
    public *;
}
