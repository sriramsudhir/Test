<template>
  <client-only>
    <div class="container-fluid mtb-20 mtb-sm-15">
      <div class="order-wrapper">
        <ul class="left-sidebar">
          <li
            :class="{active: activeRoute === 'profile'}"
          >
            <nuxt-link
              to="/user/profile"
              @click.native="goingNext('/user/profile')"
            >
              {{ $t('accountLayout.myProfile') }}
            </nuxt-link>
          </li>
          <li
            :class="{active: activeRoute === 'addresses'}"
          >
            <nuxt-link
              to="/user/addresses"
              @click.native="goingNext('/user/addresses')"
            >
              {{ $t('accountLayout.myAddressBook') }}
            </nuxt-link>
          </li>
          <li
            :class="{active: activeRoute === 'vouchers'}"
          >
            <nuxt-link
              to="/user/vouchers"
              @click.native="goingNext('/user/vouchers')"
            >
              {{ $t('accountLayout.vouchers') }}

            </nuxt-link>
          </li>
          <li
            :class="{active: activeRoute === 'orders'}"
          >
            <nuxt-link
              to="/user/orders"
              @click.native="goingNext('/user/orders')"
            >
              {{ $t('accountLayout.myOrders') }}
            </nuxt-link>
          </li>

          <li
            :class="{active: activeRoute === 'following'}"
          >
            <nuxt-link
              to="/user/following"
              @click.native="goingNext('/user/following')"
            >
              {{ $t('store.followingStores') }}
            </nuxt-link>
          </li>

          <li
            :class="{active: activeRoute === 'wishlists'}"
          >
            <nuxt-link
              to="/user/wishlists"
              @click.native="goingNext('/user/wishlists')"
            >
              {{ $t('accountLayout.myWishlist') }}
            </nuxt-link>
          </li>
          <li
            :class="{active: activeRoute === 'compared'}"
          >
            <nuxt-link
              to="/user/compared"
              @click.native="goingNext('/user/compared')"
            >
              {{ $t('accountLayout.comparedList') }}
            </nuxt-link>
          </li>
        </ul>
        <div class="right-area grow pos-rel">
          <slot
            name="rightArea"
          />
        </div>
      </div>
    </div>
  </client-only>
</template>

<script>
  export default {
    name: 'AccountLayout',
    data() {
      return {
      }
    },
    mixins: [],
    watch: {},
    props: {
      activeRoute:{
        type: String
      }
    },
    computed: {
    },
    mounted() {
    },
    methods: {
      goingNext(url){
        const clicked = url.split('/')
        this.$emit(`clicked-${clicked[clicked.length-1]}`)
      }
    },
  }
</script>
