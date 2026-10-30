#include <jni.h>
#include <string>
#include <vector>
#include <cstring>
#include "node.h"

extern "C" JNIEXPORT jint JNICALL
Java_com_kango_queenriam_BotForegroundService_startNodeWithArguments(
        JNIEnv *env,
        jobject /* this */,
        jobjectArray arguments) {

    jsize argc = env->GetArrayLength(arguments);
    int c_arguments_size = 0;

    for (int i = 0; i < argc; i++) {
        jstring arg = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *arg_chars = env->GetStringUTFChars(arg, nullptr);
        c_arguments_size += strlen(arg_chars) + 1;
        env->ReleaseStringUTFChars(arg, arg_chars);
    }

    char *args_buffer = (char *) calloc(c_arguments_size, sizeof(char));
    char *argv[argc];
    char *current_arg = args_buffer;

    for (int i = 0; i < argc; i++) {
        jstring arg = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *arg_chars = env->GetStringUTFChars(arg, nullptr);
        size_t len = strlen(arg_chars) + 1;
        strncpy(current_arg, arg_chars, len);
        argv[i] = current_arg;
        current_arg += len;
        env->ReleaseStringUTFChars(arg, arg_chars);
    }

    int node_result = node::Start(argc, argv);
    free(args_buffer);
    return jint(node_result);
}
