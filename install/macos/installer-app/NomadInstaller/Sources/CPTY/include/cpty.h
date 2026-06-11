#ifndef CPTY_H
#define CPTY_H

#include <sys/types.h>

/*
 * Spawn `/bin/bash -c <command>` inside a fresh pseudo-terminal.
 *
 * The child runs with the PTY slave as its controlling terminal and with
 * stdin/stdout/stderr wired to it, so any program it runs that reads its
 * password straight from /dev/tty (sudo, ssh) talks to the PTY — exactly as it
 * would in Terminal. Writing to the returned master fd feeds that TTY read.
 *
 * Returns the child pid and writes the PTY master fd to *out_master on success.
 * Returns -1 if forkpty() fails (out_master left untouched).
 */
pid_t cpty_spawn_bash(const char *command, int *out_master);

#endif /* CPTY_H */
