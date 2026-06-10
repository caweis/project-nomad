#include "cpty.h"

#include <util.h>    /* forkpty */
#include <unistd.h>  /* execl, _exit */

pid_t cpty_spawn_bash(const char *command, int *out_master) {
    int master = -1;

    /* forkpty() forks, and in the child: creates a new session (setsid),
     * makes the PTY slave the controlling terminal, and dup2's it onto
     * 0/1/2. The parent gets the master fd. */
    pid_t pid = forkpty(&master, /*name*/ (char *)0, /*termp*/ (void *)0,
                        /*winp*/ (void *)0);
    if (pid < 0) {
        return -1;
    }

    if (pid == 0) {
        /* Child. Only async-signal-safe work between fork and exec. */
        execl("/bin/bash", "bash", "-c", command, (char *)0);
        _exit(127); /* exec failed */
    }

    *out_master = master;
    return pid;
}
