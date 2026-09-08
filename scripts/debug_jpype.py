#!/usr/bin/env python3
import os
import traceback

os.environ["JAVA_HOME"] = "/usr/lib/jvm/java-21-openjdk-amd64"
print("JAVA_HOME", os.environ["JAVA_HOME"])

import jpype

print("jpype", jpype.__version__)
print("default jvm", jpype.getDefaultJVMPath())
print("started?", jpype.isJVMStarted())
try:
    jpype.startJVM(jpype.getDefaultJVMPath(), convertStrings=True)
    print("startJVM OK", jpype.isJVMStarted())
except Exception as e:
    print("startJVM FAIL", type(e), e)
    traceback.print_exc()

import hedera  # noqa: F401

print("hedera imported", jpype.isJVMStarted())
try:
    import jpype.imports  # noqa: F401
    from java.math import BigInteger

    print("BigInteger", BigInteger("123"))
except Exception as e:
    print("BigInteger FAIL", type(e), e)
    traceback.print_exc()

from hedera import ContractFunctionParameters

print([m for m in dir(ContractFunctionParameters) if "Uint" in m or "add" in m.lower()])
