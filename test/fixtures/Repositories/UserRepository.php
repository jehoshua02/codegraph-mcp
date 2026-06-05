<?php

namespace App\Repositories;

use App\Models\User;

class UserRepository
{
    public function findById(int $id): ?User
    {
        return User::find($id);
    }

    public function findAll(): array
    {
        return [];
    }
}
