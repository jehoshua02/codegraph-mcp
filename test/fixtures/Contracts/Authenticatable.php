<?php

namespace App\Contracts;

interface Authenticatable
{
    public function getAuthIdentifier(): string;
}
