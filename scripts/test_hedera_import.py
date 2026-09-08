#!/usr/bin/env python3
"""Test Hedera SDK imports on GCP."""
import os
import sys

# Ensure JAVA_HOME is set
java_home = os.environ.get("JAVA_HOME")
if not java_home:
    for p in ["/usr/lib/jvm/java-21-openjdk-amd64", "/usr/lib/jvm/default-java"]:
        if os.path.isdir(p):
            os.environ["JAVA_HOME"] = p
            print(f"Set JAVA_HOME={p}")
            break

try:
    print("Importing hedera...")
    from hedera import AccountId, PrivateKey, Client
    print("hedera import OK")
    
    print("Importing java.math.BigInteger...")
    from java.math import BigInteger
    print("java.math import OK")
    
    bi = BigInteger("12345")
    print(f"BigInteger test: {bi}")
    print("ALL_OK")
except Exception as e:
    print(f"FAILED: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
