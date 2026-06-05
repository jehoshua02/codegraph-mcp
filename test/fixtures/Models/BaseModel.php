<?php

namespace App\Models;

abstract class BaseModel
{
    public function save(): bool
    {
        return true;
    }

    public static function find(int $id): ?static
    {
        return null;
    }

    public static function where(string $column, mixed $value): static
    {
        return new static();
    }
}
