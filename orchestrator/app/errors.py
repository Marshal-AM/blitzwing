"""Domain errors surfaced to API clients."""


class MissingBlocksServiceError(Exception):
    """Petals cannot route to required transformer blocks."""

    def __init__(
        self,
        missing_blocks: list[int] | None = None,
        *,
        message: str | None = None,
    ) -> None:
        self.missing_blocks = missing_blocks or []
        if message:
            super().__init__(message)
        elif self.missing_blocks:
            super().__init__(
                f"No servers holding blocks {self.missing_blocks} are online. "
                "Contributors may be unreachable (NAT/firewall) or still joining."
            )
        else:
            super().__init__(
                "Required model blocks are not reachable in the swarm. "
                "Contributors may be behind NAT without relay, or still loading."
            )
