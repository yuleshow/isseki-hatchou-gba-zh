#include <mgba/core/core.h>
#include <mgba/core/log.h>
#include <mgba-util/vfs.h>
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>

static void logMessage(struct mLogger* logger, int category, enum mLogLevel level,
                       const char* format, va_list args) {
    (void) logger;
    (void) category;
    if (!(level & (mLOG_FATAL | mLOG_ERROR | mLOG_WARN))) return;
    vfprintf(stderr, format, args);
    fputc('\n', stderr);
}

static void dumpMemory(struct mCore* core, const char* prefix, const char* suffix,
                       uint32_t address, size_t size) {
    char path[4096];
    int pathLength = snprintf(path, sizeof(path), "%s.%s", prefix, suffix);
    assert(pathLength >= 0 && (size_t) pathLength < sizeof(path));
    FILE* output = fopen(path, "wb");
    assert(output);
    for (size_t offset = 0; offset < size; offset++) {
        assert(fputc(core->busRead8(core, address + offset), output) != EOF);
    }
    assert(fclose(output) == 0);
}

int main(int argc, char** argv) {
    if (argc < 4) {
        fprintf(stderr, "Usage: capture rom output-prefix frames:key-mask | watch:tile:frame-limit | mahjong-preview:animation [...]\n");
        return 1;
    }
    struct mLogger logger = { .log = logMessage };
    mLogSetDefaultLogger(&logger);
    struct mCore* core = mCoreFind(argv[1]);
    assert(core && core->init(core));
    mCoreInitConfig(core, NULL);
    mCoreConfigSetIntValue(&core->config, "useBios", 0);
    mCoreConfigSetIntValue(&core->config, "skipBios", 1);
    mCoreConfigSetIntValue(&core->config, "logLevel", 0);
    mCoreLoadConfig(core);
    unsigned width, height;
    core->desiredVideoDimensions(core, &width, &height);
    color_t* pixels = calloc(width * height, sizeof(color_t));
    assert(pixels);
    core->setVideoBuffer(core, pixels, width);
    assert(mCoreLoadFile(core, argv[1]));
    core->reset(core);
    for (int argument = 3; argument < argc; argument++) {
        unsigned animation;
        if (sscanf(argv[argument], "mahjong-preview:%u", &animation) == 1) {
            assert(((animation >= 35 && animation <= 46) || (animation >= 50 && animation <= 81)) && argument == argc - 1);
            assert(core->busRead32(core, 0x03002fa0) == 0x0812dbe8);
            assert(core->busRead16(core, 0x03002fa6) == 40);
            uint32_t frame = core->busRead32(core, 0x0812dbe8 + animation * 4);
            if (animation >= 50) {
                frame += 16;
                core->busWrite16(core, 0x03002fac, 0);
            }
            core->rawWrite32(core, 0x0812dc88, -1, frame);
            assert(core->busRead32(core, 0x0812dc88) == frame);
            core->setKeys(core, 0);
            core->runFrame(core);
            core->runFrame(core);
            fprintf(stderr, "Display-only mahjong animation fixture %u; not natural gameplay\n", animation);
            continue;
        }
        unsigned watchedTile, frameLimit;
        if (sscanf(argv[argument], "watch:%u:%u", &watchedTile, &frameLimit) == 2) {
            assert(watchedTile < 1024 && frameLimit > 0 && frameLimit <= 360000);
            bool found = false;
            for (unsigned frame = 0; frame < frameLimit && !found; frame++) {
                core->setKeys(core, frame % 180 == 0 ? 1 : 0);
                core->runFrame(core);
                for (unsigned sprite = 0; sprite < 128; sprite++) {
                    uint32_t address = 0x07000000 + sprite * 8;
                    uint16_t first = core->busRead16(core, address);
                    uint16_t second = core->busRead16(core, address + 2);
                    uint16_t third = core->busRead16(core, address + 4);
                    if ((first & 0x300) == 0x200 || (first & 255) >= 160 || (second & 511) >= 240) continue;
                    if ((third & 1023) == watchedTile && (third >> 12) == 1) {
                        fprintf(stderr, "Matched tile %u after %u frames\n", watchedTile, frame + 1);
                        found = true;
                        break;
                    }
                }
            }
            if (!found) {
                fprintf(stderr, "Tile %u not observed in %u frames\n", watchedTile, frameLimit);
                mCoreConfigDeinit(&core->config);
                core->deinit(core);
                free(pixels);
                return 2;
            }
            continue;
        }
        unsigned frames, keys;
        assert(sscanf(argv[argument], "%u:%x", &frames, &keys) == 2);
        assert(frames <= 36000 && keys <= 0x3ff);
        core->setKeys(core, keys);
        for (unsigned frame = 0; frame < frames; frame++) core->runFrame(core);
    }
    char path[4096];
    int pathLength = snprintf(path, sizeof(path), "%s.png", argv[2]);
    assert(pathLength >= 0 && (size_t) pathLength < sizeof(path));
    struct VFile* output = VFileOpen(path, O_WRONLY | O_CREAT | O_TRUNC);
    assert(output && mCoreTakeScreenshotVF(core, output));
    output->close(output);
    dumpMemory(core, argv[2], "vram", 0x06000000, 0x18000);
    dumpMemory(core, argv[2], "palette", 0x05000000, 0x400);
    dumpMemory(core, argv[2], "oam", 0x07000000, 0x400);
    dumpMemory(core, argv[2], "io", 0x04000000, 0x60);
    dumpMemory(core, argv[2], "iwram", 0x03000000, 0x8000);
    mCoreConfigDeinit(&core->config);
    core->deinit(core);
    free(pixels);
    return 0;
}