<?php

namespace App\Models;

use App\Contracts\Authenticatable;
use App\Traits\HasRoles;

class User extends BaseModel implements Authenticatable
{
    use HasRoles;

    protected $fillable = ['name', 'email'];

    public function posts()
    {
        return $this->hasMany(Post::class);
    }

    public function profile()
    {
        return $this->hasOne(Profile::class);
    }

    public function getFullNameAttribute()
    {
        return $this->first_name . ' ' . $this->last_name;
    }

    public static function findByEmail(string $email): ?self
    {
        return self::where('email', $email)->first();
    }
}
