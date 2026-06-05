<?php

namespace App\Traits;

trait HasRoles
{
    public function hasRole(string $role): bool
    {
        return in_array($role, $this->roles);
    }
}
