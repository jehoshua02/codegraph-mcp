<?php

function format_name(string $first, string $last): string
{
    return trim($first . ' ' . $last);
}

function is_active(string $status): bool
{
    return $status === 'active';
}
